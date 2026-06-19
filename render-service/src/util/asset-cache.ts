import { createHash } from 'node:crypto';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { logger } from '../logger.ts';

export type AssetExt = 'png' | 'jpg' | 'mp4' | 'mp3' | 'wav' | 'txt' | 'json';

export interface CacheKey {
  namespace: string;
  inputs: Record<string, unknown>;
  ext: AssetExt;
}

export interface CacheResult {
  path: string;
  hash: string;
  cached: boolean;
  bytes: number;
  durationMs: number;
}

// Anchor cache root to this file's location, not CWD. Running from render-service/
// (where package.json lives) otherwise doubles the segment as
// render-service/render-service/public/explode-cache. This module sits at
// render-service/src/util/asset-cache.ts → ../../public/explode-cache resolves to
// render-service/public/explode-cache regardless of CWD.
const MODULE_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(MODULE_DIR, '../../..');
const DEFAULT_ROOT = path.resolve(MODULE_DIR, '../../public/explode-cache');

// EXPLODE_CACHE_DIR env: absolute paths kept as-is; relative paths anchored to PROJECT_ROOT
// (not CWD) so the doubled-segment bug cannot return when running from render-service/.
const cacheRoot = (): string => {
  const env = process.env.EXPLODE_CACHE_DIR;
  if (!env || env.length === 0) return DEFAULT_ROOT;
  return path.isAbsolute(env) ? env : path.resolve(PROJECT_ROOT, env);
};

const canonical = (v: unknown): unknown => {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(canonical);
  return Object.keys(v as Record<string, unknown>)
    .sort()
    .reduce<Record<string, unknown>>((acc, k) => {
      acc[k] = canonical((v as Record<string, unknown>)[k]);
      return acc;
    }, {});
};

const computeHash = (key: CacheKey): string => {
  const payload = JSON.stringify({ ns: key.namespace, inputs: canonical(key.inputs) });
  return createHash('sha256').update(payload).digest('hex').slice(0, 24);
};

const fileExists = async (p: string): Promise<boolean> => {
  try {
    const st = await stat(p);
    return st.isFile() && st.size > 0;
  } catch {
    return false;
  }
};

export const resolveCachePath = async (key: CacheKey): Promise<{ path: string; hash: string }> => {
  const hash = computeHash(key);
  const dir = path.join(cacheRoot(), key.namespace);
  await mkdir(dir, { recursive: true });
  return { path: path.join(dir, `${hash}.${key.ext}`), hash };
};

export const lookupCache = async (key: CacheKey): Promise<{ hit: boolean; path: string; hash: string }> => {
  const { path: p, hash } = await resolveCachePath(key);
  const hit = await fileExists(p);
  if (hit) logger.info('cache_hit', { namespace: key.namespace, hash });
  return { hit, path: p, hash };
};

export const writeCache = async (key: CacheKey, data: Buffer): Promise<CacheResult> => {
  const { path: p, hash } = await resolveCachePath(key);
  await writeFile(p, data);
  logger.info('cache_write', { namespace: key.namespace, hash, bytes: data.byteLength });
  return { path: p, hash, cached: false, bytes: data.byteLength, durationMs: 0 };
};

export const getOrCompute = async (
  key: CacheKey,
  compute: () => Promise<Buffer>,
): Promise<CacheResult> => {
  const { path: p, hash } = await resolveCachePath(key);
  if (await fileExists(p)) {
    const buf = await readFile(p);
    logger.info('cache_hit', { namespace: key.namespace, hash, bytes: buf.byteLength });
    return { path: p, hash, cached: true, bytes: buf.byteLength, durationMs: 0 };
  }
  const started = Date.now();
  const data = await compute();
  await writeFile(p, data);
  const durationMs = Date.now() - started;
  logger.info('cache_miss_filled', { namespace: key.namespace, hash, bytes: data.byteLength, durationMs });
  return { path: p, hash, cached: false, bytes: data.byteLength, durationMs };
};
