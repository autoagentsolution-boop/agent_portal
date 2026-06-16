#!/usr/bin/env node
// Generate Frame 1 hero shot (finished dish, hero close-up) for storyboard preview.
// Used as bookend (intro + outro) of the new spiral-tour cooking video format.
// Usage: npx tsx scripts/gen-hero-frame.ts <fixture.json>

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { getOrCompute } from '../render-service/src/util/asset-cache.ts';
import { withRetry } from '../render-service/src/util/retry.ts';

const PRO_BANANA_MODEL = 'nano-banana-pro-preview';

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

type DishFixture = {
  dish_name: string;
  serving_vessel_style: string;
  table_material: string;
  background_style: string;
  final_dish_description: string;
};

const buildHeroPrompt = (d: DishFixture): string =>
  `Create a premium vertical 9:16 cinematic close-up hero shot of the finished dish "${d.dish_name}".

The dish is "${d.final_dish_description}". Served in ${d.serving_vessel_style}, placed on ${d.table_material}. Background: ${d.background_style}.

Composition:
- Tight close-up: bowl fills 65-75% of vertical frame, centered.
- Camera angle: 3/4 front view at 35 degrees down (between top-down and side view).
- Shallow depth of field; background softly blurred.
- Steam rising softly from the surface in slow motion.
- Hyper-realistic textures: glossy broth, vivid ingredient colors.
- Warm golden tungsten rim light from upper right.
- Chopsticks resting on the bowl rim.

Mood:
- Premium restaurant advertising photography.
- Cinematic food commercial feel.
- Dark moody background, dramatic lighting.
- Vietnamese culinary heritage atmosphere.
- Inviting, appetizing, ready to serve.

CRITICAL: No text. No labels. No callouts. No infographic elements. No people. Pure hero food shot.

Technical:
- 9:16 vertical aspect ratio (1080×1920 target).
- Ultra-detailed, photorealistic, food-commercial quality.
- Sharp focus on bowl contents, soft falloff on edges.`;

const callProBananaOnce = async (apiKey: string, prompt: string): Promise<Buffer> => {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${PRO_BANANA_MODEL}:generateContent`;
  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  };
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`pro_banana_http_${r.status}: ${(await r.text()).slice(0, 400)}`);
  const j: any = await r.json();
  const inline = j.candidates?.[0]?.content?.parts?.find((p: any) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('pro_banana_no_image');
  return Buffer.from(inline.data, 'base64');
};

const main = async () => {
  const fixturePath = process.argv[2];
  if (!fixturePath) throw new Error('Usage: tsx scripts/gen-hero-frame.ts <fixture.json>');

  await loadEnv('.env');
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('Missing GEMINI_API_KEY');

  const fixture: DishFixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const slug = path.basename(fixturePath, '.json');
  const outDir = path.resolve(`out/cooking-explode/${slug}`);
  await mkdir(outDir, { recursive: true });

  const prompt = buildHeroPrompt(fixture);
  await writeFile(path.join(outDir, `${slug}-hero-prompt.txt`), prompt);
  console.log(`Hero prompt: ${path.join(outDir, `${slug}-hero-prompt.txt`)}`);

  console.log(`\nGen hero shot via Nano Banana Pro…`);
  const cache = await getOrCompute(
    {
      namespace: 'hero',
      ext: 'png',
      inputs: { model: PRO_BANANA_MODEL, slug, dishName: fixture.dish_name, prompt },
    },
    () => withRetry(() => callProBananaOnce(apiKey, prompt), {
      label: 'pro_banana_hero',
      attempts: 3,
      baseMs: 3000,
      retryOn: [429, 500, 502, 503, 504],
    }),
  );

  const outImg = path.join(outDir, `${slug}-hero.png`);
  await writeFile(outImg, await readFile(cache.path));
  console.log(
    `\n✓ Hero: ${outImg} ${cache.cached ? '(cache hit, $0)' : `(fresh gen, ${(cache.durationMs / 1000).toFixed(1)}s, ~$0.06)`}`,
  );
  console.log(`\nFor storyboard review:`);
  console.log(`  Frame 1 (intro):  ${outImg}`);
  console.log(`  Frame 2 (body):   ${path.join(outDir, `${slug}-composition.png`)}`);
  console.log(`  Frame 3 (outro):  ${outImg}  (same as Frame 1)`);
};

main().catch((e) => {
  console.error('FATAL:', e);
  process.exit(1);
});
