// klingai.com (Kuaishou) direct i2v client — for users with a Resource Pack subscription
// at https://klingai.com/. Auth via JWT (HS256 with AccessKey + SecretKey) — different
// from Replicate Bearer-token route. Pricing handled in video-backends.ts.
//
// Endpoint contract (klingai.com — verified via API platform docs):
//   POST https://api.klingai.com/v1/videos/image2video
//     Headers:
//       Authorization: Bearer <JWT>      (JWT = HS256 sign of {iss, exp, nbf} with SecretKey)
//       Content-Type:  application/json
//     Body: { model_name, mode, duration, image, prompt, negative_prompt?, cfg_scale }
//   GET  https://api.klingai.com/v1/videos/image2video/{task_id}
//     poll until data.task_status ∈ {succeed, failed}
//
// Kling 2.1 input schema:
//   model_name      "kling-v2.1"
//   mode            "std" | "pro"
//   duration        "5" | "10"        (STRING — klingai requires string, not number)
//   image           base64 PNG string (no data:image/... prefix) OR public URL
//   prompt          string
//   negative_prompt string (optional)
//   cfg_scale       0.0–1.0 (default 0.5; lower = more faithful to image, higher = more creative)

import { readFile } from 'node:fs/promises';
import { createHmac } from 'node:crypto';
import { logger } from '../logger.ts';
import { withRetry } from '../util/retry.ts';

const KLINGAI_BASE = 'https://api.klingai.com';
const QUOTA_PATTERN = /quota|rate.?limit|exceed|RESOURCE_EXHAUSTED|too many requests/i;
const POLL_TERMINAL = new Set(['succeed', 'failed']);
const JWT_TTL_SEC = 1800;          // 30 min
const JWT_NBF_LEEWAY_SEC = 5;      // -5s clock skew tolerance

export type KlingaiMode = 'std' | 'pro';
export const KLINGAI_ALLOWED_DURATIONS = [5, 10] as const;
export type KlingaiDuration = (typeof KLINGAI_ALLOWED_DURATIONS)[number];

export const snapKlingaiDuration = (sec: number): KlingaiDuration => {
  const n = Math.max(1, Math.round(sec));
  return n <= 5 ? 5 : 10;
};

export interface KlingaiMotionRequest {
  imagePath: string;
  prompt: string;
  durationSeconds?: number;       // raw; snapped to {5, 10}
  mode?: KlingaiMode;
  negativePrompt?: string;
  cfgScale?: number;
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface KlingaiMotionResult {
  buffer: Buffer;
  modelName: string;
  modeUsed: KlingaiMode;
  durationUsed: KlingaiDuration;
  durationMs: number;
}

interface CreateTaskResponse {
  code?: number;
  message?: string;
  request_id?: string;
  data?: {
    task_id?: string;
    task_status?: string;
  };
}

interface PollTaskResponse {
  code?: number;
  message?: string;
  data?: {
    task_id?: string;
    task_status?: string;
    task_status_msg?: string;
    task_result?: {
      videos?: Array<{ id?: string; url?: string; duration?: string }>;
    };
  };
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const base64Url = (input: string | Buffer): string =>
  (Buffer.isBuffer(input) ? input : Buffer.from(input)).toString('base64url');

// Manual JWT HS256 — avoids adding jsonwebtoken as dep.
const signJwtHs256 = (payload: Record<string, unknown>, secret: string): string => {
  const header = base64Url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = base64Url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${sig}`;
};

const mintJwt = (accessKey: string, secretKey: string): string => {
  const now = Math.floor(Date.now() / 1000);
  return signJwtHs256(
    {
      iss: accessKey,
      exp: now + JWT_TTL_SEC,
      nbf: now - JWT_NBF_LEEWAY_SEC,
    },
    secretKey,
  );
};

const startKlingaiJob = async (
  accessKey: string,
  secretKey: string,
  body: Record<string, unknown>,
): Promise<string> => {
  const jwt = mintJwt(accessKey, secretKey);
  const r = await fetch(`${KLINGAI_BASE}/v1/videos/image2video`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify(body),
  });
  const txt = await r.text();
  if (!r.ok) {
    const err = new Error(`klingai_start_${r.status}: ${txt.slice(0, 500)}`);
    (err as { status?: number }).status = r.status;
    throw err;
  }
  let parsed: CreateTaskResponse;
  try { parsed = JSON.parse(txt); }
  catch { throw new Error(`klingai_start_bad_json: ${txt.slice(0, 200)}`); }
  if (parsed.code !== 0) {
    throw new Error(`klingai_start_code_${parsed.code}: ${parsed.message ?? 'unknown'}`);
  }
  const taskId = parsed.data?.task_id;
  if (!taskId) throw new Error(`klingai_start_no_task_id: ${txt.slice(0, 200)}`);
  return taskId;
};

const pollKlingaiJob = async (
  accessKey: string,
  secretKey: string,
  taskId: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<string> => {
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    await sleep(pollIntervalMs);
    const jwt = mintJwt(accessKey, secretKey);
    let r: Response;
    try {
      r = await fetch(`${KLINGAI_BASE}/v1/videos/image2video/${taskId}`, {
        headers: { authorization: `Bearer ${jwt}` },
      });
    } catch (err) {
      logger.warn('klingai_poll_network_error', { error: String(err).slice(0, 200) });
      continue;
    }
    if (!r.ok) {
      logger.warn('klingai_poll_transient', { status: r.status });
      continue;
    }
    const pj = (await r.json()) as PollTaskResponse;
    const status = pj.data?.task_status ?? 'unknown';
    if (!POLL_TERMINAL.has(status)) continue;

    if (status === 'failed') {
      const detail = pj.data?.task_status_msg ?? pj.message ?? 'unknown';
      throw new Error(`klingai_failed: ${detail.toString().slice(0, 300)}`);
    }

    const url = pj.data?.task_result?.videos?.[0]?.url;
    if (typeof url !== 'string' || !url.startsWith('http')) {
      throw new Error(`klingai_no_output_url: ${JSON.stringify(pj.data?.task_result).slice(0, 200)}`);
    }
    return url;
  }
  throw new Error(`klingai_poll_timeout: ${(pollTimeoutMs / 1000).toFixed(0)}s elapsed`);
};

const downloadClip = async (url: string): Promise<Buffer> => {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`klingai_download_${r.status}`);
  return Buffer.from(await r.arrayBuffer());
};

const isQuotaError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  const status = (err as { status?: number }).status;
  return status === 429 || QUOTA_PATTERN.test(msg);
};

export const generateKlingaiDirectMotion = async (req: KlingaiMotionRequest): Promise<KlingaiMotionResult> => {
  const accessKey = process.env.KLINGAI_ACCESS_KEY;
  const secretKey = process.env.KLINGAI_SECRET_KEY;
  if (!accessKey) throw new Error('KLINGAI_ACCESS_KEY required');
  if (!secretKey) throw new Error('KLINGAI_SECRET_KEY required');

  const modelName = process.env.KLINGAI_MODEL ?? 'kling-v2-1';
  const mode: KlingaiMode = (process.env.KLINGAI_MODE as KlingaiMode | undefined) ?? req.mode ?? 'std';
  const duration = snapKlingaiDuration(req.durationSeconds ?? 5);
  const cfgScale = req.cfgScale ?? 0.5;
  const pollIntervalMs = req.pollIntervalMs ?? 8000;
  const pollTimeoutMs = req.pollTimeoutMs ?? 10 * 60 * 1000;
  const started = Date.now();

  // klingai accepts image as a plain base64 string (NOT a data: URI prefix).
  const imageB64 = (await readFile(req.imagePath)).toString('base64');

  const body: Record<string, unknown> = {
    model_name: modelName,
    mode,
    duration: String(duration),   // klingai requires STRING for duration
    image: imageB64,
    prompt: req.prompt,
    cfg_scale: cfgScale,
  };
  if (req.negativePrompt) body.negative_prompt = req.negativePrompt;

  logger.info('klingai_start', { modelName, mode, duration });
  const taskId = await withRetry(() => startKlingaiJob(accessKey, secretKey, body), {
    label: `klingai_start_${modelName}`,
    attempts: 3,
    retryOn: [500, 502, 503, 504],
  });
  logger.info('klingai_op_running', { modelName, taskId });

  const mp4Url = await pollKlingaiJob(accessKey, secretKey, taskId, pollIntervalMs, pollTimeoutMs);
  const buffer = await downloadClip(mp4Url);

  return {
    buffer,
    modelName,
    modeUsed: mode,
    durationUsed: duration,
    durationMs: Date.now() - started,
  };
};

export const isKlingaiQuotaError = isQuotaError;
