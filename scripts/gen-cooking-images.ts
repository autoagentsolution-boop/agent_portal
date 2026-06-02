#!/usr/bin/env node
// Generate real food photos via Nano Banana (Gemini Image API) for a cooking fixture.
// Reads the fixture, gens dish hero + per-ingredient images, saves to a SHARED asset dir
// so the same ingredient (e.g. "Thịt bò") used across multiple fixtures is generated ONCE.
//
// Asset layout (shared across all cooking fixtures):
//   render-service/public/cooking-assets/dishes/<dish-slug>.png       — one per dish
//   render-service/public/cooking-assets/ingredients/<ing-slug>.png   — one per unique ingredient name
//
// Filename = pure kebab-case slug (no hash). Same Vietnamese ingredient name → same file.
// User: pick consistent names across fixtures to maximize cache reuse.
//
// Usage:
//   GEMINI_API_KEY=AIza... npx tsx scripts/gen-cooking-images.ts <fixture.json>
//
// Idempotent: skips images that already exist on disk (in shared dir).

import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Minimal .env loader (avoids dotenv dep so script runs from any cwd without npm install).
const loadEnvFile = async (envPath: string): Promise<void> => {
  try {
    const content = await readFile(envPath, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      const key = m[1]!;
      let value = m[2] ?? '';
      // strip optional surrounding quotes
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    }
  } catch {
    // .env missing is OK; user may set vars in shell
  }
};

const PUBLIC_ROOT = path.resolve('render-service/public');
const DISH_DIR = path.join(PUBLIC_ROOT, 'cooking-assets/dishes');
const ING_DIR = path.join(PUBLIC_ROOT, 'cooking-assets/ingredients');
const DISH_REL = 'cooking-assets/dishes';
const ING_REL = 'cooking-assets/ingredients';

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
  await loadEnvFile(path.resolve('.env'));
  const apiKey = process.env.GEMINI_API_KEY ?? process.env.NANO_BANANA_API_KEY;
  if (!apiKey) {
    console.error('Set GEMINI_API_KEY env var (or NANO_BANANA_API_KEY).');
    process.exit(1);
  }

  const fixturePath = process.argv[2];
  if (!fixturePath) {
    console.error('Usage: tsx scripts/gen-cooking-images.ts <fixture.json>');
    process.exit(1);
  }

  await mkdir(DISH_DIR, { recursive: true });
  await mkdir(ING_DIR, { recursive: true });

  const fixture = JSON.parse(await readFile(fixturePath, 'utf8')) as Fixture;
  let gens = 0;
  let reuses = 0;

  // ---- Dish hero (unique per dish) ----
  const dishSlug = slug(fixture.dishName);
  const dishFile = path.join(DISH_DIR, `${dishSlug}.png`);
  const dishRel = `${DISH_REL}/${dishSlug}.png`;
  if (await fileExists(dishFile)) {
    console.log(`[reuse] dish: ${dishRel}`);
    reuses++;
  } else {
    console.log(`[gen]   dish: ${fixture.dishName}...`);
    const buf = await callNanoBanana(buildDishPrompt(fixture.dishName), apiKey);
    await writeFile(dishFile, buf);
    console.log(`[ok]    dish → ${dishRel} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
    gens++;
  }
  fixture.dishImagePath = dishRel;

  // ---- Ingredients (dedup by NAME — share across fixtures) ----
  const allIngredients = fixture.steps.flatMap((step) => step.ingredients);
  const uniqueByName = new Map<string, { name: string; amount?: string; slug: string }>();
  for (const ing of allIngredients) {
    const s = slug(ing.name);
    if (!uniqueByName.has(s)) uniqueByName.set(s, { name: ing.name, amount: ing.amount, slug: s });
  }

  const BATCH = 4;
  const tasks = [...uniqueByName.values()];
  for (let i = 0; i < tasks.length; i += BATCH) {
    const batch = tasks.slice(i, i + BATCH);
    await Promise.all(
      batch.map(async (t) => {
        const outFile = path.join(ING_DIR, `${t.slug}.png`);
        const relPath = `${ING_REL}/${t.slug}.png`;
        if (await fileExists(outFile)) {
          console.log(`[reuse] ${t.name} → ${relPath}`);
          reuses++;
          return;
        }
        try {
          console.log(`[gen]   ${t.name}...`);
          const buf = await callNanoBanana(buildIngredientPrompt(t.name, t.amount), apiKey);
          await writeFile(outFile, buf);
          console.log(`[ok]    ${t.name} → ${relPath} (${(buf.byteLength / 1024).toFixed(0)} KB)`);
          gens++;
        } catch (err) {
          console.error(`[fail]  ${t.name}: ${String(err).slice(0, 200)}`);
        }
      }),
    );
  }

  // Patch fixture: every ingredient occurrence gets its slug path (if file exists)
  for (const step of fixture.steps) {
    for (const ing of step.ingredients) {
      const s = slug(ing.name);
      const outFile = path.join(ING_DIR, `${s}.png`);
      if (await fileExists(outFile)) {
        ing.imagePath = `${ING_REL}/${s}.png`;
      }
    }
  }

  await writeFile(fixturePath, JSON.stringify(fixture, null, 2) + '\n', 'utf8');
  const estCost = (gens * 0.039).toFixed(2);
  console.log(`\n[done] Patched fixture: ${fixturePath}`);
  console.log(`[done] Gens: ${gens} new · Reuses: ${reuses} cached · Est cost: $${estCost}`);
  console.log(`[done] Shared assets: ${DISH_DIR}, ${ING_DIR}`);
  console.log('\nRe-render with: npx remotion render src/templates/index.tsx CookingExplosion out/cooking-real.mp4 --props=' + fixturePath);
};

main().catch((err: unknown) => {
  console.error('error:', err);
  process.exit(1);
});
