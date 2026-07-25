// Image generation via Gemini (Nano Banana). VENDORED into MKTAgent from
// render-service/src/image/nano-banana.ts so MKTAgent owns its image capability
// with no cross-service HTTP / runtime dependency (decision 2026-06-29). Deps are
// rewired to MKTAgent's own logger/retry/env. Caching is filesystem-only here
// (MKTAgent has its own DB, no shared Asset table): the content hash IS the
// filename, so an existing file is a cache hit. No DB row, no migration.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import { withRetry } from '../lib/retry.ts';
import { quotaErrorFrom } from '../lib/quota-error.ts';
import type { GeminiUsage } from '../orchestration/executor/node-cost.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// MKTAgent-owned output dir (sibling of src). The publisher reads it via the
// `local:` AssetStore scheme.
export const IMAGE_OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'images');

// Base (fast, cheap) vs Pro image model. Base renders Latin text acceptably but MANGLES Vietnamese
// diacritics on-frame ("Nắng Sớm" → "Nắng Sóm"); Pro renders stylized legible text — including VN — so
// the caller opts INTO Pro for any image carrying on-frame text (F1). Pro is ~3× the price, so it is NOT
// the default: text-free images stay on base. Model ids per the image-generation API (2026-07).
const MODEL_BASE = 'gemini-2.5-flash-image';
const MODEL_PRO = 'gemini-3-pro-image';
export type ImageQuality = 'base' | 'pro';
const modelFor = (quality: ImageQuality | undefined): string => (quality === 'pro' ? MODEL_PRO : MODEL_BASE);
const endpointFor = (model: string): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

export type ImageMode = 'text-to-image' | 'edit';

export interface ImageRequest {
  prompt: string;
  mode: ImageMode;
  referenceImagePath?: string;
  // Opt into the Pro image model (gemini-3-pro-image) — required for legible on-frame text, esp.
  // Vietnamese diacritics, which the base model corrupts. Default 'base' (cheap). The runner sets 'pro'
  // whenever the image carries on-frame text (F1).
  quality?: ImageQuality;
}

export interface ImageResult {
  imagePath: string; // public-style path (/files/images/<hash>.png) — informational
  outputFile: string; // absolute path on disk — what the `local:` AssetStore reads
  cached: boolean;
  durationMs: number;
  // Real token usage from the response (Gemini image gen bills image output AS tokens). null on a
  // cache hit (no provider call) or if the envelope omitted usageMetadata → caller falls back to
  // the flat per-image price. Lets the ledger + node badge show real tokens instead of 0.
  usage?: GeminiUsage | null;
}

// Model is part of the cache key: a base render and a Pro render of the SAME prompt are different
// images (Pro renders text correctly, base doesn't), so they must not collide on disk.
const hashKey = ({ prompt, mode, referenceImagePath, quality }: ImageRequest): string =>
  createHash('sha256')
    .update(`${modelFor(quality)}::${mode}::${referenceImagePath ?? ''}::${prompt}`)
    .digest('hex')
    .slice(0, 24);

const fileExists = async (p: string): Promise<boolean> => {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
};

const loadReferenceAsInline = async (p: string): Promise<{ mimeType: string; data: string }> => {
  const buf = await readFile(p);
  const ext = path.extname(p).slice(1).toLowerCase();
  const mimeType = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext || 'png'}`;
  return { mimeType, data: buf.toString('base64') };
};

const callNanoBanana = async (req: ImageRequest): Promise<{ png: Buffer; usage: GeminiUsage | null }> => {
  const apiKey = process.env.NANO_BANANA_API_KEY ?? env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('NANO_BANANA_API_KEY or GEMINI_API_KEY required');

  const model = modelFor(req.quality);
  const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
  if (req.mode === 'edit' && req.referenceImagePath) {
    const inlineData = await loadReferenceAsInline(req.referenceImagePath);
    parts.push({ inlineData });
  }

  const response = await fetch(endpointFor(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!response.ok) {
    const body = await response.text();
    // 429 splits into a transient per-minute burst (retried by withRetry) and a per-day exhaustion
    // (not retryable today — surfaced immediately so the caller can stop instead of truncating).
    if (response.status === 429) throw quotaErrorFrom(body, model);
    throw new Error(`nano_banana_http_${response.status}: ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
    usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number; cachedContentTokenCount?: number };
  };
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('nano_banana_no_image_in_response');
  const u = json.usageMetadata;
  const usage: GeminiUsage | null = u
    ? { promptTokens: u.promptTokenCount ?? 0, outputTokens: u.candidatesTokenCount ?? 0, thoughtTokens: 0, cachedTokens: u.cachedContentTokenCount ?? 0 }
    : null;
  return { png: Buffer.from(inline.data, 'base64'), usage };
};

export const generate = async (req: ImageRequest): Promise<ImageResult> => {
  await mkdir(IMAGE_OUTPUT_DIR, { recursive: true });
  const key = hashKey(req);
  const outputFile = path.join(IMAGE_OUTPUT_DIR, `${key}.png`);
  const imagePath = `/files/images/${key}.png`;

  if (await fileExists(outputFile)) {
    logger.info('image_cache_hit', { key });
    return { imagePath, outputFile, cached: true, durationMs: 0 };
  }

  const started = Date.now();
  const { png, usage } = await withRetry(() => callNanoBanana(req), { label: 'nano_banana' });
  await writeFile(outputFile, png);
  const durationMs = Date.now() - started;
  logger.info('image_generated', { key, model: modelFor(req.quality), ms: durationMs, bytes: png.byteLength, tokens: usage ? usage.promptTokens + usage.outputTokens : null });
  return { imagePath, outputFile, cached: false, durationMs, usage };
};

// The provider model id an ImageRequest resolves to — exported so the runner attributes cost/usage to
// the RIGHT model (base vs Pro have different token prices) instead of hardcoding the base id.
export const imageModelId = (req: Pick<ImageRequest, 'quality'>): string => modelFor(req.quality);
