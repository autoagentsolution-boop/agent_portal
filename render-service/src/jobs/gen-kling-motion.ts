// Replicate Kling 2.1 i2v client.
// Mirrors shape of gen-explode-motion.ts (Veo) so motion-v2.ts can dispatch by VIDEO_PROVIDER env.
//
// Endpoint contract (Replicate):
//   POST https://api.replicate.com/v1/predictions
//     Auth:  "Authorization: Bearer $REPLICATE_API_TOKEN"
//     Body:  { version: "kwaivgi/kling-v2.1:<hash>" OR "kwaivgi/kling-v2.1", input: { ... } }
//   GET  https://api.replicate.com/v1/predictions/{id}
//     poll until status ∈ {succeeded, failed, canceled}
//
// Kling 2.1 input schema (verified 2026-06-17):
//   prompt           string
//   start_image      string (URL or "data:image/png;base64,...")
//   duration         5 | 10   (seconds — Kling 2.1 hard constraint)
//   aspect_ratio     "16:9" | "9:16" | "1:1"
//   mode             "standard" | "pro"   (pro = +text/end_image support, ~2.5× cost)
//   negative_prompt  string (optional)
//
// Cost reality (Standard mode, Replicate as of 2026-06-17):
//   Kling 2.1 Standard ~$0.10/5s clip, ~$0.20/10s clip
//   Kling 2.1 Pro       ~$0.25/5s clip
// Pricing may drift — verify on https://replicate.com/account/billing after sign-up.

import { readFile } from 'node:fs/promises';
import { logger } from '../logger.ts';
import { withRetry } from '../util/retry.ts';

const REPLICATE_BASE = 'https://api.replicate.com/v1';
const QUOTA_PATTERN = /quota|rate.?limit|RESOURCE_EXHAUSTED|too many requests/i;
const POLL_TERMINAL = new Set(['succeeded', 'failed', 'canceled']);

export type KlingMode = 'standard' | 'pro';
export const KLING_ALLOWED_DURATIONS = [5, 10] as const;
export type KlingDuration = (typeof KLING_ALLOWED_DURATIONS)[number];

export const snapKlingDuration = (sec: number): KlingDuration => {
  const n = Math.max(1, Math.round(sec));
  return n <= 5 ? 5 : 10;
};

export interface KlingMotionRequest {
  imagePath: string;
  prompt: string;
  durationSeconds?: number;       // raw; will be snapped to {5,10}
  aspectRatio?: '9:16' | '16:9' | '1:1';
  mode?: KlingMode;
  negativePrompt?: string;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface KlingMotionResult {
  buffer: Buffer;
  modelVersion: string;
  modeUsed: KlingMode;
  durationUsed: KlingDuration;
  durationMs: number;
}

interface PredictionResponse {
  id?: string;
  status?: string;
  output?: string | string[] | null;
  error?: string | null;
  detail?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const startKlingJob = async (
  token: string,
  modelVersion: string,
  body: Record<string, unknown>,
): Promise<string> => {
  const r = await fetch(`${REPLICATE_BASE}/predictions`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ version: modelVersion, input: body }),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 500);
    const err = new Error(`kling_start_${r.status}: ${txt}`);
    (err as { status?: number }).status = r.status;
    throw err;
  }
  const j = (await r.json()) as PredictionResponse;
  if (!j.id) throw new Error('kling_start_no_prediction_id');
  return j.id;
};

const pollKlingJob = async (
  token: string,
  predictionId: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<string> => {
  const pollUrl = `${REPLICATE_BASE}/predictions/${predictionId}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    await sleep(pollIntervalMs);
    let r: Response;
    try {
      r = await fetch(pollUrl, { headers: { authorization: `Bearer ${token}` } });
    } catch (err) {
      logger.warn('kling_poll_network_error', { error: String(err).slice(0, 200) });
      continue;
    }
    if (!r.ok) {
      logger.warn('kling_poll_transient', { status: r.status });
      continue;
    }
    const pj = (await r.json()) as PredictionResponse;
    const status = pj.status ?? 'unknown';
    if (!POLL_TERMINAL.has(status)) continue;

    if (status === 'failed' || status === 'canceled') {
      throw new Error(`kling_failed: ${(pj.error ?? pj.detail ?? status).toString().slice(0, 300)}`);
    }

    // succeeded — output may be string (single URL) or array (multiple URLs). Kling 2.1 emits single string.
    const out = pj.output;
    const url = Array.isArray(out) ? out[0] : out;
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error(`kling_no_output_url: ${JSON.stringify(pj.output).slice(0, 200)}`);
    }
    return url;
  }
  throw new Error(`kling_poll_timeout: ${(pollTimeoutMs / 1000).toFixed(0)}s elapsed`);
};

const downloadClip = async (url: string): Promise<Buffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`kling_download_${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const isQuotaError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  const status = (err as { status?: number }).status;
  return status === 429 || QUOTA_PATTERN.test(msg);
};

export const generateKlingMotion = async (req: KlingMotionRequest): Promise<KlingMotionResult> => {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('REPLICATE_API_TOKEN required');

  const modelVersion = process.env.KLING_MODEL ?? 'kwaivgi/kling-v2.1';
  const mode: KlingMode = (process.env.KLING_MODE as KlingMode | undefined) ?? req.mode ?? 'standard';
  const duration = snapKlingDuration(req.durationSeconds ?? 5);
  const aspectRatio = req.aspectRatio ?? '9:16';
  const pollIntervalMs = req.pollIntervalMs ?? 8000;
  const pollTimeoutMs = req.pollTimeoutMs ?? 10 * 60 * 1000;
  const started = Date.now();

  const imageB64 = (await readFile(req.imagePath)).toString('base64');
  const dataUri = `data:image/png;base64,${imageB64}`;

  const input: Record<string, unknown> = {
    prompt: req.prompt,
    start_image: dataUri,
    duration,
    aspect_ratio: aspectRatio,
    mode,
  };
  if (req.negativePrompt) input.negative_prompt = req.negativePrompt;

  logger.info('kling_start', { modelVersion, mode, duration, aspectRatio });
  const predictionId = await withRetry(() => startKlingJob(token, modelVersion, input), {
    label: `kling_start_${modelVersion}`,
    attempts: 3,
    retryOn: [500, 502, 503, 504],
  });
  logger.info('kling_op_running', { modelVersion, predictionId });

  const mp4Url = await pollKlingJob(token, predictionId, pollIntervalMs, pollTimeoutMs);
  const buffer = await downloadClip(mp4Url);

  return {
    buffer,
    modelVersion,
    modeUsed: mode,
    durationUsed: duration,
    durationMs: Date.now() - started,
  };
};

// Helper for upstream router: detect transient/quota classification consistently.
export const isKlingQuotaError = isQuotaError;
