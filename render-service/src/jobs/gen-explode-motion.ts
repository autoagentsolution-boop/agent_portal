import { readFile } from 'node:fs/promises';
import { logger } from '../logger.ts';
import { withRetry } from '../util/retry.ts';

export type VeoModel =
  | 'veo-3.1-lite-generate-preview'
  | 'veo-3.1-fast-generate-preview'
  | 'veo-3.0-fast-generate-001';

export const VEO_LITE: VeoModel = 'veo-3.1-lite-generate-preview';
export const VEO_FAST: VeoModel = 'veo-3.1-fast-generate-preview';

export interface MotionRequest {
  imagePath: string;
  prompt: string;
  durationSeconds?: number;
  aspectRatio?: '9:16' | '16:9' | '1:1';
  pollIntervalMs?: number;
  pollTimeoutMs?: number;
}

export interface MotionResult {
  buffer: Buffer;
  modelUsed: VeoModel;
  durationMs: number;
}

const ENDPOINT = (model: VeoModel): string =>
  `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

const QUOTA_PATTERN = /quota|rate.?limit|RESOURCE_EXHAUSTED/i;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const startVeoJob = async (
  apiKey: string,
  model: VeoModel,
  imageB64: string,
  req: MotionRequest,
): Promise<string> => {
  const body = {
    instances: [
      {
        prompt: req.prompt,
        image: { bytesBase64Encoded: imageB64, mimeType: 'image/png' },
      },
    ],
    parameters: {
      aspectRatio: req.aspectRatio ?? '9:16',
      personGeneration: 'allow_all',
      durationSeconds: req.durationSeconds ?? 8,
    },
  };
  const r = await fetch(ENDPOINT(model), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const txt = (await r.text()).slice(0, 500);
    const err = new Error(`veo_start_${r.status}: ${txt}`);
    (err as { status?: number }).status = r.status;
    throw err;
  }
  const j = (await r.json()) as { name?: string };
  if (!j.name) throw new Error('veo_start_no_op_name');
  return j.name;
};

const pollVeoJob = async (
  apiKey: string,
  opName: string,
  pollIntervalMs: number,
  pollTimeoutMs: number,
): Promise<Buffer> => {
  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}`;
  const startedAt = Date.now();

  while (Date.now() - startedAt < pollTimeoutMs) {
    await sleep(pollIntervalMs);
    let r: Response;
    try {
      r = await fetch(pollUrl, { headers: { 'x-goog-api-key': apiKey } });
    } catch (err) {
      // Transient network errors (UND_ERR_CONNECT_TIMEOUT, ECONNRESET, etc) → just retry next tick.
      logger.warn('veo_poll_network_error', { error: String(err).slice(0, 200) });
      continue;
    }
    if (!r.ok) {
      logger.warn('veo_poll_transient', { status: r.status });
      continue;
    }
    const pj = (await r.json()) as {
      done?: boolean;
      error?: unknown;
      response?: {
        generateVideoResponse?: { generatedSamples?: Array<Record<string, unknown>> };
        generatedVideos?: Array<Record<string, unknown>>;
        videos?: Array<Record<string, unknown>>;
      };
    };
    if (!pj.done) continue;
    if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error).slice(0, 300)}`);

    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0] ??
      pj.response?.generatedVideos?.[0] ??
      pj.response?.videos?.[0];
    if (!v0) throw new Error(`veo_no_video_payload: ${JSON.stringify(pj.response).slice(0, 300)}`);

    const video = (v0 as { video?: Record<string, unknown> }).video as Record<string, unknown> | undefined;
    const inlineB64 =
      (video?.encodedVideo as string | undefined) ??
      ((v0 as { bytesBase64Encoded?: string }).bytesBase64Encoded as string | undefined);
    if (inlineB64) return Buffer.from(inlineB64, 'base64');

    const uri =
      (video?.uri as string | undefined) ??
      (video?.videoUri as string | undefined) ??
      ((v0 as { uri?: string }).uri as string | undefined);
    if (uri) {
      const dl = await fetch(uri, { headers: { 'x-goog-api-key': apiKey } });
      if (!dl.ok) throw new Error(`veo_download_${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new Error('veo_no_payload_no_uri');
  }
  throw new Error(`veo_poll_timeout: ${(pollTimeoutMs / 1000).toFixed(0)}s elapsed`);
};

const isQuotaError = (err: unknown): boolean => {
  if (typeof err !== 'object' || err === null) return false;
  const msg = (err as { message?: string }).message ?? '';
  const status = (err as { status?: number }).status;
  return status === 429 || QUOTA_PATTERN.test(msg);
};

export const generateMotion = async (req: MotionRequest): Promise<MotionResult> => {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required');

  const imageB64 = (await readFile(req.imagePath)).toString('base64');
  const pollIntervalMs = req.pollIntervalMs ?? 8000;
  const pollTimeoutMs = req.pollTimeoutMs ?? 10 * 60 * 1000;
  const started = Date.now();

  const attempt = async (model: VeoModel): Promise<Buffer> => {
    logger.info('veo_start', { model });
    const opName = await withRetry(() => startVeoJob(apiKey, model, imageB64, req), {
      label: `veo_start_${model}`,
      attempts: 3,
      retryOn: [500, 502, 503, 504],
    });
    logger.info('veo_op_running', { model, op: opName });
    return pollVeoJob(apiKey, opName, pollIntervalMs, pollTimeoutMs);
  };

  try {
    const buffer = await attempt(VEO_LITE);
    return { buffer, modelUsed: VEO_LITE, durationMs: Date.now() - started };
  } catch (err) {
    if (!isQuotaError(err)) throw err;
    logger.warn('veo_lite_quota_falling_back_fast', { error: String(err).slice(0, 200) });
    const buffer = await attempt(VEO_FAST);
    return { buffer, modelUsed: VEO_FAST, durationMs: Date.now() - started };
  }
};
