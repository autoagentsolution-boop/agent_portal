// Video backend registry — abstracts Veo vs Kling vs (future) Hailuo behind one interface.
// motion-v2.ts dispatches by VIDEO_PROVIDER env. gen-storyboard-clips.ts uses the chosen
// backend for the actual API call + cost accounting + cache namespace.

import { generateMotion as generateVeoMotion } from './gen-explode-motion.ts';
import { generateKlingMotion, snapKlingDuration } from './gen-kling-motion.ts';
import { generateKlingaiDirectMotion } from './gen-klingai-direct-motion.ts';

export type VideoProvider = 'veo' | 'kling';

export interface VideoBackendRequest {
  imagePath: string;
  prompt: string;
  durationSeconds: number;
  // Veo-only routing hint. Ignored by Kling backends.
  modelHint?: 'lite' | 'fast';
}

export interface VideoBackend {
  name: VideoProvider;
  cacheNamespace: string;
  // Cost model is provider-specific:
  //   Veo bills per SECOND of generated video → computeCostUsd uses (durationSec × $/sec).
  //     modelHint='fast' bills at $0.10/sec, 'lite' or undefined at $0.05/sec.
  //   Kling/Replicate bills per GENERATION (1 unit fixed per clip) → constant per duration tier,
  //     ignores modelHint.
  // Always call computeCostUsd(durationSec, modelHint) — never read costPerClipUsd directly.
  computeCostUsd: (durationSec: number, modelHint?: 'lite' | 'fast') => number;
  snapDuration: (sec: number) => number;
  generate: (req: VideoBackendRequest) => Promise<Buffer>;
  isRetryable: (err: unknown) => boolean;
  // Sleep this many ms AFTER a fresh (non-cached) generation before starting the next
  // spec in the batch loop. Lets providers self-throttle to fit per-minute API caps
  // without 429s mid-batch. Default 0 (no throttling). Cached hits skip the sleep.
  interCallDelayMs: () => number;
}

// ============================================================================
// Veo 3.1
// ============================================================================
//
// Veo bills per SECOND of generated video. Rates per Google AI Studio pricing (2026-06-17):
//   veo-3.1-lite-generate-preview:  $0.05/sec at 720p, $0.08/sec at 1080p
//   veo-3.1-fast-generate-preview:  $0.10/sec at 720p, $0.12/sec at 1080p
//   veo-3.1-generate-preview:       $0.40/sec at 720p/1080p
//
// gen-explode-motion.ts always requests Lite first, falls back to Fast on 429.
// Cost estimator uses Lite-720p as the optimistic estimate; actual bill is higher when
// Fast fallback fires. Override via VEO_USD_PER_SEC env if needed.

const VEO_DEFAULT_USD_PER_SEC = 0.05;     // Lite 720p — cheapest path
const VEO_FAST_USD_PER_SEC = 0.10;        // Fast 720p — used when modelHint='fast'
// Tier 1 Veo preview models cap at 2 RPM → 30s minimum spacing. 35s gives margin against
// clock-edge bursts. Tier 2 (10 RPM) can drop to 6s; Tier 3 (20 RPM) to 3s.
// Override via VEO_INTER_CALL_DELAY_MS env once you're on Tier 2+.
const VEO_DEFAULT_INTER_CALL_DELAY_MS = 35_000;
const VEO_ALLOWED = [4, 6, 8] as const;
const snapVeoDuration = (sec: number): number => {
  const n = Math.max(1, Math.round(sec));
  for (const allowed of VEO_ALLOWED) {
    if (n <= allowed) return allowed;
  }
  return 8;
};

const veoCostUsdPerSec = (modelHint?: 'lite' | 'fast'): number => {
  const env = Number(process.env.VEO_USD_PER_SEC ?? '');
  // Env override always wins (manual price discovery for new tiers).
  if (Number.isFinite(env) && env > 0) return env;
  return modelHint === 'fast' ? VEO_FAST_USD_PER_SEC : VEO_DEFAULT_USD_PER_SEC;
};

const veoInterCallDelayMs = (): number => {
  const env = Number(process.env.VEO_INTER_CALL_DELAY_MS ?? '');
  return Number.isFinite(env) && env >= 0 ? env : VEO_DEFAULT_INTER_CALL_DELAY_MS;
};

const isVeoRetryable = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  // Veo "internal server" + transient network/HTTP errors. Skip retry on filter rejection or missing API key.
  return /veo_failed.*code"?:\s*13|internal server|temporarily|UNAVAILABLE|RESOURCE_EXHAUSTED|veo_poll_timeout|UND_ERR/i.test(msg);
};

export const veoBackend: VideoBackend = {
  name: 'veo',
  cacheNamespace: 'storyboard-clip',
  computeCostUsd: (durationSec, modelHint) => snapVeoDuration(durationSec) * veoCostUsdPerSec(modelHint),
  snapDuration: snapVeoDuration,
  generate: async (req) => {
    const r = await generateVeoMotion({
      imagePath: req.imagePath,
      prompt: req.prompt,
      durationSeconds: req.durationSeconds,
      preferredModel: req.modelHint,
    });
    return r.buffer;
  },
  isRetryable: isVeoRetryable,
  interCallDelayMs: veoInterCallDelayMs,
};

// ============================================================================
// Kling 2.1 via Replicate (or klingai.com direct)
// ============================================================================
//
// Kling bills per GENERATION (1 unit per prediction) with fixed prices per duration tier.
// Two price points depending on which platform user routes to:
//
//   Replicate (default, current gen-kling-motion.ts client):
//     Std  5s = $0.25,  10s = $0.50
//     Pro  5s = $0.45,  10s = $0.90
//
//   klingai.com direct (Kuaishou API, requires separate client — not implemented yet):
//     Std  5s = $0.28 (2 units),    10s = $0.56 (4 units)
//     Pro  5s = $0.49 (3.5 units),  10s = $0.98 (7 units)
//     1 Resource Pack unit = $0.14. 100 units ≈ $14.
//
// Replicate is ~12% cheaper because Kuaishou offers a wholesale rate to platforms.
// Override via KLING_PLATFORM env if you sub direct on klingai.com.

const KLING_PRICE_TABLES = {
  replicate: {
    standard: { 5: 0.25, 10: 0.50 },
    pro:      { 5: 0.45, 10: 0.90 },
  },
  klingai: {
    standard: { 5: 0.28, 10: 0.56 },
    pro:      { 5: 0.49, 10: 0.98 },
  },
} as const;

const klingPlatform = (): 'replicate' | 'klingai' =>
  process.env.KLING_PLATFORM === 'klingai' ? 'klingai' : 'replicate';

// Structural type — `typeof KLING_PRICE_TABLES.replicate` would be a too-narrow literal union
// because TS infers different literal types per platform sub-table.
type KlingPriceTable = {
  readonly standard: { readonly 5: number; readonly 10: number };
  readonly pro: { readonly 5: number; readonly 10: number };
};

const KLING_PRICE_TABLE_GETTER = (): KlingPriceTable => KLING_PRICE_TABLES[klingPlatform()];

const klingMode = (): 'standard' | 'pro' =>
  process.env.KLING_MODE === 'pro' ? 'pro' : 'standard';

const klingComputeCostUsd = (durationSec: number): number => {
  const snapped = snapKlingDuration(durationSec) as 5 | 10;
  return KLING_PRICE_TABLE_GETTER()[klingMode()][snapped];
};

const isKlingRetryable = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  // Replicate transient: 5xx, network resets, polling timeouts. Skip retry on auth fail / filter rejection.
  return /kling_poll_(transient|timeout|network)|kling_start_5\d\d|UND_ERR|ECONNRESET|fetch failed/i.test(msg);
};

// klingBackend dispatches by KLING_PLATFORM env at call-time. Cache namespace + generate fn
// differ per platform so clips from Replicate vs klingai don't cross-contaminate the cache.

// Kling Replicate quota is per-generation with no documented RPM ceiling — let
// concurrency stay backend-side. klingai.com direct also has no public RPM cap
// for paid Resource Packs at the volumes we use. Override via KLING_INTER_CALL_DELAY_MS
// if user observes 429s.
const klingInterCallDelayMs = (): number => {
  const env = Number(process.env.KLING_INTER_CALL_DELAY_MS ?? '');
  return Number.isFinite(env) && env >= 0 ? env : 0;
};

const klingReplicateBackend: VideoBackend = {
  name: 'kling',
  cacheNamespace: 'storyboard-clip-kling-replicate',
  computeCostUsd: klingComputeCostUsd,
  snapDuration: snapKlingDuration,
  generate: async (req) => {
    const r = await generateKlingMotion({
      imagePath: req.imagePath,
      prompt: req.prompt,
      durationSeconds: req.durationSeconds,
    });
    return r.buffer;
  },
  isRetryable: isKlingRetryable,
  interCallDelayMs: klingInterCallDelayMs,
};

const klingaiDirectBackend: VideoBackend = {
  name: 'kling',
  cacheNamespace: 'storyboard-clip-klingai',
  computeCostUsd: klingComputeCostUsd,
  snapDuration: snapKlingDuration,
  generate: async (req) => {
    const r = await generateKlingaiDirectMotion({
      imagePath: req.imagePath,
      prompt: req.prompt,
      durationSeconds: req.durationSeconds,
      mode: klingMode() === 'pro' ? 'pro' : 'std',
    });
    return r.buffer;
  },
  isRetryable: isKlingRetryable,
  interCallDelayMs: klingInterCallDelayMs,
};

// ============================================================================

export const getVideoBackend = (provider?: string): VideoBackend => {
  const name = (provider ?? process.env.VIDEO_PROVIDER ?? 'veo').toLowerCase();
  if (name === 'kling') {
    return klingPlatform() === 'klingai' ? klingaiDirectBackend : klingReplicateBackend;
  }
  if (name === 'veo') return veoBackend;
  throw new Error(`unknown_video_provider: ${name} (expected 'veo' or 'kling')`);
};
