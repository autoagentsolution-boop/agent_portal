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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// MKTAgent-owned output dir (sibling of src). The publisher reads it via the
// `local:` AssetStore scheme.
export const IMAGE_OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'images');
const MODEL = 'gemini-2.5-flash-image';
const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;

export type ImageMode = 'text-to-image' | 'edit';

export interface ImageRequest {
  prompt: string;
  mode: ImageMode;
  referenceImagePath?: string;
}

export interface ImageResult {
  imagePath: string; // public-style path (/files/images/<hash>.png) — informational
  outputFile: string; // absolute path on disk — what the `local:` AssetStore reads
  cached: boolean;
  durationMs: number;
}

const hashKey = ({ prompt, mode, referenceImagePath }: ImageRequest): string =>
  createHash('sha256')
    .update(`${MODEL}::${mode}::${referenceImagePath ?? ''}::${prompt}`)
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

const callNanoBanana = async (req: ImageRequest): Promise<Buffer> => {
  const apiKey = process.env.NANO_BANANA_API_KEY ?? env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('NANO_BANANA_API_KEY or GEMINI_API_KEY required');

  const parts: Array<Record<string, unknown>> = [{ text: req.prompt }];
  if (req.mode === 'edit' && req.referenceImagePath) {
    const inlineData = await loadReferenceAsInline(req.referenceImagePath);
    parts.push({ inlineData });
  }

  const response = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({ contents: [{ parts }] }),
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`nano_banana_http_${response.status}: ${body.slice(0, 300)}`);
  }
  const json = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string } }> } }>;
  };
  const inline = json.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data)?.inlineData;
  if (!inline?.data) throw new Error('nano_banana_no_image_in_response');
  return Buffer.from(inline.data, 'base64');
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
  const png = await withRetry(() => callNanoBanana(req), { label: 'nano_banana' });
  await writeFile(outputFile, png);
  const durationMs = Date.now() - started;
  logger.info('image_generated', { key, ms: durationMs, bytes: png.byteLength });
  return { imagePath, outputFile, cached: false, durationMs };
};
