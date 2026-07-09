// Voice / read-aloud (P3 V1) — turns an Atria reply or an Impact report into speech on demand.
// Owner-scoped (requireAuth), cost-tracked, and cached: the underlying video-pipeline TTS is
// filesystem-cached by (model, voice, text) hash, so re-reading the same message is free. Reuses
// Gemini TTS (GEMINI_API_KEY) — the only speech provider configured. Returns raw audio/wav bytes so
// the browser can play a Blob URL directly (no static file exposure of the audio output dir).
import { Router, type Request, type Response } from 'express';
import { readFile } from 'node:fs/promises';
import { asyncHandler, fail } from './http.ts';
import { generate } from '../video/tts.ts';
import { recordMediaCost } from '../cost/llm-usage.ts';
import { logRun } from '../db/client.ts';

export const voiceRouter: Router = Router();

const MAX_TEXT = 4000; // bound latency + cost; longer narration is truncated at a sentence-ish edge
const TTS_MODEL = 'gemini-2.5-flash-preview-tts';
const TTS_COST_USD = 0.02; // mirrors node-cost.ts ttsCost() flat estimate — keep in lock-step
const MIN_INTERVAL_MS = 1500; // per-owner throttle so varying text can't drive unbounded Gemini-TTS spend

// Last-request timestamp per owner. In-process only (same constraint as the SSE bus); a multi-instance
// deploy would move this to Redis. Enough to stop a hot loop hammering paid synthesis.
const lastCallAt = new Map<string, number>();

// Truncate to the last sentence break under the cap so narration doesn't cut mid-word.
const clampNarration = (raw: string): string => {
  const t = raw.trim();
  if (t.length <= MAX_TEXT) return t;
  const cut = t.slice(0, MAX_TEXT);
  const lastBreak = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'), cut.lastIndexOf('! '), cut.lastIndexOf('? '));
  return lastBreak > MAX_TEXT * 0.5 ? cut.slice(0, lastBreak + 1) : cut;
};

voiceRouter.post(
  '/tts',
  asyncHandler(async (req: Request, res: Response) => {
    const body = (req.body ?? {}) as { text?: unknown; voice?: unknown };
    const text = typeof body.text === 'string' ? clampNarration(body.text) : '';
    if (!text) return fail(res, 400, 'text_required', 'provide non-empty text to narrate');
    const voice = typeof body.voice === 'string' && body.voice ? body.voice : undefined;

    // Per-owner throttle — a hot loop of varying text would otherwise drive unbounded paid synthesis.
    const owner = req.userId!;
    const now = Date.now();
    const prev = lastCallAt.get(owner);
    if (prev !== undefined && now - prev < MIN_INTERVAL_MS) return fail(res, 429, 'rate_limited', 'slow down');
    lastCallAt.set(owner, now);

    let result: { outputFile: string; cached: boolean };
    try {
      result = await generate({ text, voice });
    } catch (e) {
      return fail(res, 502, 'tts_failed', String(e).slice(0, 200));
    }
    // Charge only a real synthesis; a cache hit re-reads the same WAV for free.
    if (!result.cached) {
      await recordMediaCost({ ownerId: req.userId!, surface: 'voice', model: TTS_MODEL, costUsd: TTS_COST_USD });
      await logRun('info', 'voice_tts', { chars: text.length }, req.userId!).catch(() => {});
    }
    const wav = await readFile(result.outputFile);
    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', String(wav.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.status(200).end(wav);
  }),
);
