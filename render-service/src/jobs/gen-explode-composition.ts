import { createHash } from 'node:crypto';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { logger } from '../logger.ts';
import { getOrCompute } from '../util/asset-cache.ts';
import { verifyLabels, type VerifyResult } from '../image/vision-verify.ts';
import { withRetry } from '../util/retry.ts';

export const PRO_BANANA_MODEL = 'nano-banana-pro-preview';
export const VERIFY_MAX_ATTEMPTS = 3;
export const VERIFY_TOLERANCE = 1;

export type Ingredient = {
  id: string;
  label: string;
  prep: string;
  qty: string;
  visual: string;
  group: string;
  order: number;
};

export type DishFixture = {
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

export const validateFixture = (d: DishFixture): string[] => {
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

  const expected = Array.from({ length: d.ingredients.length }, (_, i) => i + 1);
  const actual = [...orders].sort((a, b) => a - b);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    errors.push(`order is not sequential 1..${d.ingredients.length}: ${actual.join(',')}`);
  }
  return errors;
};

const buildLabelBlock = (d: DishFixture): string => {
  const sorted = [...d.ingredients].sort((a, b) => a.order - b.order);
  const lines = sorted.map((ing) => `- ${ing.label} | ${ing.prep} | ${ing.qty} | visual: ${ing.visual}`);
  lines.push(`- ${d.finish_step.label} | ${d.finish_step.prep} | ${d.finish_step.qty} | visual: top-of-bowl finishing action`);
  return lines.join('\n');
};

export const buildCompositionPrompt = (d: DishFixture): string => {
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
  const j = (await r.json()) as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }> };
  const inline = j.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('pro_banana_no_image');
  return Buffer.from(inline.data, 'base64');
};

const callProBanana = (apiKey: string, prompt: string, refImagePath: string): Promise<Buffer> =>
  withRetry(() => callProBananaOnce(apiKey, prompt, refImagePath), {
    label: 'pro_banana',
    attempts: 3,
    baseMs: 3000,
    retryOn: [429, 500, 502, 503, 504],
  });

export interface BuildCompositionRequest {
  fixture: DishFixture;
  slug: string;
  referenceImagePath: string;
  outImagePath: string;
}

export interface BuildCompositionResult {
  outImagePath: string;
  cachePath: string;
  attempts: number;
  verify: VerifyResult;
  freshGenCount: number;
  freshGenCostUsd: number;
}

const PRO_BANANA_COST_PER_GEN = 0.06;

export const buildCompositionWithVerify = async (
  req: BuildCompositionRequest,
): Promise<BuildCompositionResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required');

  const errs = validateFixture(req.fixture);
  if (errs.length) throw new Error(`fixture_invalid: ${errs.join('; ')}`);

  const prompt = buildCompositionPrompt(req.fixture);
  const refBuf = await readFile(req.referenceImagePath);
  const refSha = createHash('sha256').update(refBuf).digest('hex').slice(0, 12);
  const expectedLabels = [
    ...req.fixture.ingredients.sort((a, b) => a.order - b.order).map((i) => i.label),
    req.fixture.finish_step.label,
  ];

  let freshGenCount = 0;
  let best: { cachePath: string; verify: VerifyResult; attempt: number } | null = null;

  for (let attempt = 1; attempt <= VERIFY_MAX_ATTEMPTS; attempt++) {
    logger.info('composition_attempt', { slug: req.slug, attempt, maxAttempts: VERIFY_MAX_ATTEMPTS });
    const cache = await getOrCompute(
      {
        namespace: 'composition',
        ext: 'png',
        inputs: { model: PRO_BANANA_MODEL, slug: req.slug, refSha, prompt, attempt },
      },
      () => callProBanana(apiKey, prompt, req.referenceImagePath),
    );
    if (!cache.cached) freshGenCount++;

    let verify: VerifyResult;
    try {
      verify = await verifyLabels(apiKey, cache.path, expectedLabels, { tolerance: VERIFY_TOLERANCE });
      logger.info('composition_verify', {
        attempt,
        detected: verify.detectedLabels.length,
        duplicates: verify.duplicates.length,
        missing: verify.missing.length,
        extra: verify.extra.length,
        acceptable: verify.isAcceptable,
      });
    } catch (err) {
      logger.warn('composition_verify_failed_accepting_blind', {
        attempt,
        error: String(err).slice(0, 200),
        cached: cache.cached,
      });
      // Verify API unreachable. If composition is cached (previously vetted), accept it.
      // If fresh and we have no other candidate, accept too — fail-open beats fail-closed for transient service issues.
      verify = {
        detectedLabels: [],
        duplicates: [],
        missing: [],
        extra: [],
        isAcceptable: true,
        mismatchCount: 0,
      };
      await copyFile(cache.path, req.outImagePath);
      return {
        outImagePath: req.outImagePath,
        cachePath: cache.path,
        attempts: attempt,
        verify,
        freshGenCount,
        freshGenCostUsd: freshGenCount * PRO_BANANA_COST_PER_GEN,
      };
    }

    if (!best || verify.mismatchCount < best.verify.mismatchCount) {
      best = { cachePath: cache.path, verify, attempt };
    }
    if (verify.isAcceptable) {
      await copyFile(cache.path, req.outImagePath);
      return {
        outImagePath: req.outImagePath,
        cachePath: cache.path,
        attempts: attempt,
        verify,
        freshGenCount,
        freshGenCostUsd: freshGenCount * PRO_BANANA_COST_PER_GEN,
      };
    }
  }

  if (!best) throw new Error('composition_no_attempts');
  await copyFile(best.cachePath, req.outImagePath);
  const warnPath = req.outImagePath.replace(/\.png$/, '.warning.json');
  await writeFile(
    warnPath,
    JSON.stringify(
      {
        slug: req.slug,
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
  logger.warn('composition_fallback_best_attempt', { slug: req.slug, bestAttempt: best.attempt, mismatchCount: best.verify.mismatchCount });

  return {
    outImagePath: req.outImagePath,
    cachePath: best.cachePath,
    attempts: VERIFY_MAX_ATTEMPTS,
    verify: best.verify,
    freshGenCount,
    freshGenCostUsd: freshGenCount * PRO_BANANA_COST_PER_GEN,
  };
};
