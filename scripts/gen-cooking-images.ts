#!/usr/bin/env node
// Generate real food photos via Nano Banana (Gemini Image API) for a cooking fixture.
// Reads the fixture, gens dish hero + per-ingredient images, saves to public/, patches fixture imagePaths in place.
//
// Usage:
//   GEMINI_API_KEY=AIza... npx tsx scripts/gen-cooking-images.ts <fixture.json> [out-dir]
//
// Idempotent: skips images that already exist on disk.

import 'dotenv/config';
import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

const MODEL = 'gemini-2.5-flash-image-preview';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

const slug = (s: string): string =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const callNanoBanana = async (prompt: string, apiKey: string): Promise<Buffer> => {
  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`nano_banana_${response.status}: ${body.slice(0, 250)}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('nano_banana_no_image_in_response');
  return Buffer.from(inline.data, 'base64');
};

const buildDishPrompt = (dishName: string): string =>
  `Professional Vietnamese food photography, top-down hero shot of a steaming hot bowl of ${dishName}, traditional ceramic bowl with blue rim, fresh herb garnish on top, rich golden broth visible, dark moody wooden background, dramatic cinematic side lighting, hyper-realistic, vibrant saturated colors, shallow depth of field, no text, no watermark, 1:1 aspect ratio, ultra detailed, advertising photography style`;

const buildIngredientPrompt = (name: string, amount: string | undefined): string =>
  `Professional studio food photography, top-down close-up of ${name}${amount ? ` (${amount})` : ''}, fresh and vibrant, on dark slate or wooden surface, soft cinematic key light from upper-left, hyper-realistic, sharp focus, no text, no labels, no watermark, square composition, advertising-quality product shot, Vietnamese ingredient`;

interface Fixture {
  dishName: string;
  dishImagePath?: string;
  steps: Array<{
    ingredients: Array<{
      id: number;
      name: string;
      amount?: string;
      imagePath?: string;
      color: string;
    }>;
  }>;
  [k: string]: unknown;
}

const main = async (): Promise<void> => {
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY env var (or NANO_BANANA_API_KEY).');
    process.exit(1);
  }

  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: tsx scripts/gen-cooking-images.ts <fixture.json> [out-dir]');
    process.exit(1);
  }

  const outDirArg = process.argv[3];
  const fixtureBase = path.basename(fixturePath, '.json');
  const outDirAbs = path.resolve(outDirArg ?? `render-service/public/${fixtureBase}`);
  const outDirRel = path.relative(path.resolve('render-service/public'), outDirAbs).replace(/\\/g, '/');

  await mkdir(outDirAbs, { recursive: true });

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;

  // ---- Dish hero ----
  const dishFile = path.join(outDirAbs, 'dish-hero.png');
  const dishPath = `${outDirRel}/dish-hero.png`;
  if (await fileExists(dishFile)) {
    console.log(`[skip] dish hero exists: ${dishFile}`);
  } else {
    console.log('[gen]  dish hero...');
    const buf = await callNanoBanana(buildDishPrompt(fixture.dishName), apiKey);
    await writeFile(dishFile, buf);
    console.log(`[ok]   wrote ${dishFile} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
  }
  fixture.dishImagePath = dishPath;

  // ---- Ingredients (parallel batches of 4) ----
  const allIngredients = fixture.steps.flatMap((step) => step.ingredients);
  const seenIds = new Set<number>();
  const uniqueIngredients = allIngredients.filter((ing) => {
    if (seenIds.has(ing.id)) return false;
    seenIds.add(ing.id);
    return true;
  });

  const slugMap = new Map<number, string>();
  for (const ing of uniqueIngredients) {
    const key = `${slug(ing.name)}-${createHash('md5').update(ing.name).digest('hex').slice(0, 4)}`;
    slugMap.set(ing.id, key);
  }

  const BATCH = 4;
  for (let i = 0; i < uniqueIngredients.length; i += BATCH) {
    const batch = uniqueIngredients.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (ing) => {
        const key = slugMap.get(ing.id)!;
        const outFile = path.join(outDirAbs, `${key}.png`);
        const relPath = `${outDirRel}/${key}.png`;
        if (await fileExists(outFile)) {
          console.log(`[skip] ${ing.name} → ${relPath}`);
          return;
        }
        try {
          console.log(`[gen]  ${ing.name}...`);
          const buf = await callNanoBanana(buildIngredientPrompt(ing.name, ing.amount), apiKey);
          await writeFile(outFile, buf);
          console.log(`[ok]   ${ing.name} → ${outFile} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
        } catch (err) {
          console.error(`[fail] ${ing.name}: ${String(err).slice(0, 200)}`);
        }
      }),
    );
  }

  // Patch fixture: set imagePath on every ingredient occurrence (handles re-use across steps)
  for (const step of fixture.steps) {
    for (const ing of step.ingredients) {
      const key = slugMap.get(ing.id);
      if (!key) continue;
      const outFile = path.join(outDirAbs, `${key}.png`);
      if (await fileExists(outFile)) {
        ing.imagePath = `${outDirRel}/${key}.png`;
      }
    }
  }

  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  console.log(`\n[done] Patched fixture: ${fixturePath}`);
  console.log(`[done] Images in: ${outDirAbs}`);
  console.log('Now re-render: npx remotion render src/templates/index.tsx CookingExplosion out/cooking-real.mp4 --props=' + fixturePath);
};

main().catch((err: unknown) => {
  console.error('error:', err);
  process.exit(1);
});
