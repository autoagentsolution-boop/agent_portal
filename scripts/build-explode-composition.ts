#!/usr/bin/env node
// Build exploded-view food composition from a dish JSON fixture.
// Pipeline: load fixture → validate (no dupes, all fields, sequential order)
//          → assemble prompt from user template
//          → call Nano Banana Pro with foodexplode2.png as style reference
//          → save composition PNG
//
// Usage: npx tsx scripts/build-explode-composition.ts <fixture.json>

import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getOrCompute, lookupCache } from '../render-service/src/util/asset-cache.ts';
import { verifyLabels, type VerifyResult } from '../render-service/src/image/vision-verify.ts';

const PRO_BANANA_MODEL = 'nano-banana-pro-preview';
const VERIFY_MAX_ATTEMPTS = 3;
const VERIFY_TOLERANCE = 1;

const loadEnv = async (p: string) => {
  try {
    const c = await readFile(p, 'utf8');
    for (const ln of c.split(/\r?\n/)) {
      const m = ln.match(/^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2] ?? '';
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (!(m[1]! in process.env)) process.env[m[1]!] = v;
    }
  } catch {}
};

type Ingredient = {
  id: string;
  label: string;
  prep: string;
  qty: string;
  visual: string;
  group: string;
  order: number;
};

type DishFixture = {
  dish_name: string;
  dish_name_display: string;
  tagline: string;
  serving_vessel_style: string;
  table_material: string;
  background_style: string;
  core_visual_flow: string;
  final_dish_description: string;
  finish_step: { label: string; prep: string; qty: string };
  ingredients: Ingredient[];
};

// --- Validation per user spec ---
const validate = (d: DishFixture) => {
  const errors: string[] = [];
  const required = ['id', 'label', 'prep', 'qty', 'visual', 'order'] as const;

  const ids = new Set<string>();
  const labels = new Set<string>();
  const orders = new Set<number>();

  d.ingredients.forEach((ing, i) => {
    required.forEach((f) => {
      if (ing[f] === undefined || ing[f] === null || ing[f] === '') {
        errors.push(`[${i}] missing field "${f}" on id=${ing.id ?? '?'}`);
      }
    });
    if (ids.has(ing.id)) errors.push(`duplicate id: ${ing.id}`);
    ids.add(ing.id);
    if (labels.has(ing.label)) errors.push(`duplicate label: ${ing.label}`);
    labels.add(ing.label);
    if (orders.has(ing.order)) errors.push(`duplicate order: ${ing.order} (id=${ing.id})`);
    orders.add(ing.order);
  });

  // Check order is sequential 1..N
  const expected = Array.from({ length: d.ingredients.length }, (_, i) => i + 1);
  const actual = [...orders].sort((a, b) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`order is not sequential 1..${d.ingredients.length}: ${actual.join(',')}`);
  }

  return errors;
};

// --- Label block builder (sorted by order, bottom-to-top) ---
const buildLabelBlock = (d: DishFixture): string => {
  const sorted = [...d.ingredients].sort((a, b) => a.order - b.order);
  const lines = sorted.map((ing) => `- ${ing.label} | ${ing.prep} | ${ing.qty} | visual: ${ing.visual}`);
  // Add finish step at top
  lines.push(`- ${d.finish_step.label} | ${d.finish_step.prep} | ${d.finish_step.qty} | visual: top-of-bowl finishing action`);
  return lines.join('\n');
};

// --- Prompt template (user-provided) ---
const buildPrompt = (d: DishFixture): string => {
  const labelBlock = buildLabelBlock(d);
  return `Create a premium vertical food advertising key visual for "${d.dish_name}", designed as a cinematic stop-motion exploded-view poster.

Main composition:
Show the finished dish at the bottom center as the hero shot. The final dish is "${d.final_dish_description}". It is served in ${d.serving_vessel_style} and placed on ${d.table_material}. Use ${d.background_style}. Add subtle steam and a premium restaurant-commercial atmosphere.

Visual concept:
A dramatic vertical swirling vortex made of ${d.core_visual_flow} rises upward from the finished dish. Around this vortex, arrange all ingredients in a clean exploded-view composition from bottom to top according to the preparation and assembly order.

STRICT COMPOSITION RULES:
1. The finished bowl/dish at the bottom may naturally contain the ingredients as part of the final serving.
2. In the exploded section above the bowl, each ingredient must appear exactly once and only once.
3. Do not duplicate any ingredient in the exploded section.
4. Do not omit any ingredient from the exploded section.
5. Each ingredient in the exploded section must have exactly one matching Vietnamese label.
6. Do not place extra hidden ingredients inside the liquid vortex.
7. The liquid vortex is only a visual connector made of broth/sauce/steam, not a container for duplicate ingredient objects.
8. Keep the exploded ingredients clearly separated, easy to identify, and not merged together.
9. Ensure there is only one exploded noodle bundle, only one exploded portion per ingredient, and no duplicate clusters.
10. Ensure visual consistency between label text and the ingredient shown.

Ingredient placement:
- Arrange ingredients from bottom to top in logical cooking / assembly order.
- Keep spacing balanced and premium.
- Use photorealistic textures and realistic food forms.
- The exploded elements should feel suspended in mid-air, frozen in stop motion.

Infographic callouts:
Add elegant Vietnamese labels on both sides of the image using thin premium gold connector lines. Each label must include:
- ingredient name
- preparation method
- quantity

Important:
Every label listed below must appear exactly once.
Every ingredient listed below must be visually represented exactly once in the exploded section.

Use these exact labels:
${labelBlock}

Bottom title:
"${d.dish_name_display}"

Subtitle:
"${d.tagline}"

Style direction:
- photorealistic
- cinematic food photography
- dark moody background
- warm soft golden lighting
- Vietnamese traditional culinary atmosphere
- premium restaurant advertising poster
- stop-motion key visual
- ultra detailed
- clean luxurious layout
- readable typography
- no clutter
- no people

Technical direction:
Vertical 9:16 composition.
Food-commercial close-up feel.
Shallow depth of field.
Highly realistic steam and liquid splash.`;
};

// --- Pro Banana with reference image (returns PNG buffer) ---
import { withRetry } from '../render-service/src/util/retry.ts';

const callProBananaOnce = async (apiKey: string, prompt: string, refImagePath: string): Promise<Buffer> => {
  const refBytes = (await readFile(refImagePath)).toString('base64');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PRO_BANANA_MODEL}:generateContent`;
  const body = {
    contents: [
      {
        parts: [
          { inlineData: { mimeType: 'image/png', data: refBytes } },
          { text: prompt },
        ],
      },
    ],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`pro_banana_http_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData)?.inlineData;
  if (!inline?.data) throw new Error(`no_image_in_response: ${JSON.stringify(j).slice(0, 500)}`);
  return Buffer.from(inline.data, 'base64');
};

const genComposition = (apiKey: string, prompt: string, refImagePath: string): Promise<Buffer> =>
  withRetry(() => callProBananaOnce(apiKey, prompt, refImagePath), {
    label: 'pro_banana',
    attempts: 3,
    baseMs: 3000,
    retryOn: [429, 500, 502, 503, 504],
  });

const main = async () => {
  const fixturePath = process.argv[2];
  if (!fixturePath) throw new Error('Usage: tsx build-explode-composition.ts <fixture.json>');

  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');

  const dish: DishFixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  console.log(`Dish: ${dish.dish_name} | ingredients: ${dish.ingredients.length}`);

  // --- Validate ---
  const errs = validate(dish);
  if (errs.length) {
    console.error('VALIDATION FAILED:');
    errs.forEach((e) => console.error(`  - ${e}`));
    process.exit(1);
  }
  console.log('✓ Validation passed');

  // --- Build prompt ---
  const prompt = buildPrompt(dish);
  const slug = path.basename(fixturePath, '.json');
  const outDir = path.resolve('out/quality-test-d/spiral-v2');
  await mkdir(outDir, { recursive: true });
  await writeFile(path.join(outDir, `${slug}-prompt.txt`), prompt);
  console.log(`✓ Prompt: ${path.join(outDir, `${slug}-prompt.txt`)}`);

  // --- Gen composition (with cache + vision-verify retry loop) ---
  const refImg = path.resolve('screenshot/foodexplode2.png');
  const outImg = path.join(outDir, `${slug}-composition.png`);
  const refBuf = await readFile(refImg);
  const refSha = createHash('sha256').update(refBuf).digest('hex').slice(0, 12);

  const expectedLabels = [
    ...dish.ingredients.sort((a, b) => a.order - b.order).map((i) => i.label),
    dish.finish_step.label,
  ];

  type AttemptRecord = {
    attempt: number;
    cachePath: string;
    cached: boolean;
    verify: VerifyResult;
  };
  let best: AttemptRecord | null = null;

  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    console.log(`\n[attempt ${attempt}/${VERIFY_MAX_ATTEMPTS}] gen via Nano Banana Pro…`);
    const cacheResult = await getOrCompute(
      {
        namespace: 'composition',
        ext: 'png',
        inputs: { model: PRO_BANANA_MODEL, slug, refSha, prompt, attempt },
      },
      () => genComposition(apiKey, prompt, refImg),
    );
    console.log(
      `  ${cacheResult.cached ? 'cache hit ($0)' : `fresh gen (${(cacheResult.durationMs / 1000).toFixed(1)}s)`} → ${path.basename(cacheResult.path)}`,
    );

    console.log('  vision-verify (Gemini Flash)…');
    const verify = await verifyLabels(apiKey, cacheResult.path, expectedLabels, {
      tolerance: VERIFY_TOLERANCE,
    });
    console.log(
      `  → ${verify.detectedLabels.length} labels | dup=${verify.duplicates.length} missing=${verify.missing.length} extra=${verify.extra.length}`,
    );
    if (verify.missing.length) console.log(`    missing: ${verify.missing.slice(0, 5).join(', ')}${verify.missing.length > 5 ? '…' : ''}`);
    if (verify.duplicates.length) console.log(`    dup:     ${verify.duplicates.slice(0, 5).join(', ')}`);

    const record: AttemptRecord = { attempt, cachePath: cacheResult.path, cached: cacheResult.cached, verify };
    if (!best || verify.mismatchCount < best.verify.mismatchCount) best = record;

    if (verify.isAcceptable) {
      await copyFile(cacheResult.path, outImg);
      console.log(`\n✓ Composition: ${outImg} (attempt ${attempt}, mismatches=${verify.mismatchCount})`);
      console.log(`  cache: ${cacheResult.path}`);
      return;
    }
    if (attempt < VERIFY_MAX_ATTEMPTS) console.log('  → retry with fresh gen…');
  }

  // All attempts exhausted → save best with warning
  if (!best) throw new Error('no_attempts_recorded');
  await copyFile(best.cachePath, outImg);
  const warnPath = path.join(outDir, `${slug}-composition.warning.json`);
  await writeFile(
    warnPath,
    JSON.stringify(
      {
        slug,
        bestAttempt: best.attempt,
        mismatchCount: best.verify.mismatchCount,
        duplicates: best.verify.duplicates,
        missing: best.verify.missing,
        extra: best.verify.extra,
        detectedLabels: best.verify.detectedLabels,
        expectedLabels,
      },
      null,
      2,
    ),
  );
  console.warn(`\n⚠ Composition saved (best attempt ${best.attempt}, mismatches=${best.verify.mismatchCount}, tolerance=${VERIFY_TOLERANCE})`);
  console.warn(`  warning report: ${warnPath}`);
  console.warn(`  ${outImg}`);
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
