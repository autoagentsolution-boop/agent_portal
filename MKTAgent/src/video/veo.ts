// Video generation via Veo image-to-video (Gemini predictLongRunning). Ported from the
// video-farm probe (scripts/veo-i2v-tilt-test.ts) into MKTAgent so the video agent owns its
// capability. Takes ONE still image + a motion prompt → an ~8s mp4 clip. Filesystem cache:
// the content hash IS the filename, so a repeated (image, prompt) is a cache hit (Veo is
// slow + paid — caching matters). No DB row, mirrors imagegen/nano-banana.
//
// ⚠️ Veo is slow (~1-2 min/clip) and rate-limited (Tier-1 2-5 RPM). Callers that render
// multiple clips must serialize + space them (see runVideo).
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const VIDEO_OUTPUT_DIR = path.resolve(__dirname, '..', '..', 'output', 'videos');
// veo-3.1-lite is the cheapest i2v tier; override via VEO_MODEL if needed.
const MODEL = env.VEO_MODEL || 'veo-3.1-lite-generate-preview';
const POLL_MS = 8000;
const TIMEOUT_MS = 10 * 60 * 1000;

export interface VideoRequest {
  referenceImagePath: string; // absolute path to the still to animate
  prompt: string; // motion / camera direction
  durationSec?: number; // 4 | 6 | 8 (Veo accepts these); default 8
  aspectRatio?: string; // default '9:16'
}

export interface VideoResult {
  outputFile: string; // absolute mp4 path — what the `local:` AssetStore reads
  cached: boolean;
  durationMs: number;
}

const hashKey = (req: VideoRequest, imgBytes: Buffer): string =>
  createHash('sha256')
    .update(`${MODEL}::${req.prompt}::${req.durationSec ?? 8}::${req.aspectRatio ?? '9:16'}::`)
    .update(imgBytes)
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

// Start the long-running op. Veo's native audio is AI-invented (ambient/speech we can't
// control) and a common RAI-filter cause — so where the model supports it we send
// generateAudio:false and mix a scripted TTS voiceover downstream. But silent-only tiers
// (e.g. veo-3.1-lite) REJECT the param with a 400 rather than ignoring it. So we try with
// the param, and if that specific 400 fires, retry once without it (a silent model has no
// native audio to suppress anyway). Returns the operation name.
// Veo Tier-1 allows only ~2 RPM, so a pipeline that renders several clips can trip a
// transient 429 (RESOURCE_EXHAUSTED) even with plenty of daily quota (RPD) left — the burst,
// not the day, is the limit. A 429/503 here clears once the rolling-minute window rolls over,
// so we back off and retry rather than failing the whole video node. Waits span >60s total to
// outlast the window. (A true daily-quota exhaustion just retries a few times then surfaces.)
const RETRYABLE_START = new Set([429, 503]);
const MAX_START_RETRIES = 4;
const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

const startVeoOp = async (req: VideoRequest, imgB64: string, apiKey: string): Promise<string> => {
  const startUrl = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:predictLongRunning?key=${apiKey}`;
  const build = (withAudio: boolean) => ({
    instances: [{ prompt: req.prompt, image: { bytesBase64Encoded: imgB64, mimeType: 'image/png' } }],
    parameters: {
      aspectRatio: req.aspectRatio ?? '9:16',
      personGeneration: 'allow_all',
      durationSeconds: req.durationSec ?? 8,
      ...(withAudio ? { generateAudio: false } : {}),
    },
  });
  const post = (body: object) => fetch(startUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  let withAudio = true;
  for (let attempt = 0; ; attempt++) {
    const r = await post(build(withAudio));
    // silent-only tiers (veo-3.1-lite) reject generateAudio with a 400 → drop it and retry now.
    if (r.status === 400) {
      const text = await r.text();
      if (withAudio && /generateAudio/i.test(text)) {
        logger.info('veo_retry_without_generate_audio', { model: MODEL });
        withAudio = false;
        continue;
      }
      throw new Error(`veo_start_400: ${text.slice(0, 400)}`);
    }
    if (RETRYABLE_START.has(r.status) && attempt < MAX_START_RETRIES) {
      const text = await r.text();
      const waitMs = Math.min(75_000, 25_000 * (attempt + 1)); // 25s, 50s, 75s, 75s — outlasts the 1-min RPM window
      logger.warn('veo_start_rate_limited_retry', { status: r.status, attempt, waitMs, detail: text.slice(0, 160) });
      await sleep(waitMs);
      continue;
    }
    if (!r.ok) throw new Error(`veo_start_${r.status}: ${(await r.text()).slice(0, 400)}`);
    const op = (await r.json()) as { name?: string };
    if (!op.name) throw new Error('veo_no_operation');
    return op.name;
  }
};

// Kick off the long-running op, poll until done, return the mp4 bytes.
const callVeo = async (req: VideoRequest, imgB64: string, apiKey: string): Promise<Buffer> => {
  const opName = await startVeoOp(req, imgB64, apiKey);
  logger.info('veo_started', { op: opName, model: MODEL });

  const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${opName}?key=${apiKey}`;
  const start = Date.now();
  while (Date.now() - start < TIMEOUT_MS) {
    await new Promise((res) => setTimeout(res, POLL_MS));
    const p = await fetch(pollUrl);
    if (!p.ok) continue;
    const pj = (await p.json()) as any;
    if (!pj.done) continue;
    if (pj.error) throw new Error(`veo_failed: ${JSON.stringify(pj.error).slice(0, 300)}`);
    // RAI / safety filter: the response carries a filtered count + reason but no video.
    // Surface the actual reason so the user knows WHY (e.g. a flagged prompt), not a cryptic no-video.
    const gvr = pj.response?.generateVideoResponse ?? pj.response;
    if (gvr?.raiMediaFilteredCount && !gvr?.generatedSamples?.length) {
      const reason = Array.isArray(gvr.raiMediaFilteredReasons) ? gvr.raiMediaFilteredReasons[0] : 'safety filter';
      throw new Error(`veo_rai_filtered: ${String(reason).slice(0, 300)}`);
    }
    const v0 =
      pj.response?.generateVideoResponse?.generatedSamples?.[0] ??
      pj.response?.generatedVideos?.[0] ??
      pj.response?.videos?.[0];
    if (!v0) throw new Error(`veo_no_video: ${JSON.stringify(pj.response).slice(0, 300)}`);
    const inline = v0.video?.encodedVideo ?? v0.bytesBase64Encoded;
    if (inline) return Buffer.from(inline, 'base64');
    const uri = v0.video?.uri ?? v0.uri ?? v0.video?.videoUri;
    if (uri) {
      const sep = uri.includes('?') ? '&' : '?';
      const dl = await fetch(`${uri}${sep}key=${apiKey}`);
      if (!dl.ok) throw new Error(`veo_download_${dl.status}`);
      return Buffer.from(await dl.arrayBuffer());
    }
    throw new Error('veo_no_payload');
  }
  throw new Error('veo_timeout');
};

// Animate one still image into an mp4 clip. Cached by (model, prompt, params, image bytes).
export const generate = async (req: VideoRequest): Promise<VideoResult> => {
  const apiKey = env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY required for Veo');
  await mkdir(VIDEO_OUTPUT_DIR, { recursive: true });

  const imgBytes = await readFile(req.referenceImagePath);
  const key = hashKey(req, imgBytes);
  const outputFile = path.join(VIDEO_OUTPUT_DIR, `${key}.mp4`);
  if (await fileExists(outputFile)) {
    logger.info('veo_cache_hit', { key });
    return { outputFile, cached: true, durationMs: 0 };
  }

  const started = Date.now();
  const mp4 = await callVeo(req, imgBytes.toString('base64'), apiKey);
  await writeFile(outputFile, mp4);
  const durationMs = Date.now() - started;
  logger.info('veo_generated', { key, ms: durationMs, bytes: mp4.byteLength });
  return { outputFile, cached: false, durationMs };
};
