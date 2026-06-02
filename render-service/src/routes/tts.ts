import { Router } from 'express';
import { z } from 'zod';
import { ROLES, ttsRoute } from '../tts/router.ts';
import { synthesize, VOICE_WHITELIST } from '../tts/edge.ts';
import { logger } from '../logger.ts';

export const ttsRouter = Router();

const VOICE_ID_REGEX = /^(gcloud|edge):[a-z]{2}-[A-Z]{2}-[A-Za-z0-9-]+$/;

const genericSchema = z.object({
  text: z.string().min(1).max(800),
  jobId: z.string().uuid(),
  role: z.enum(ROLES).default('narrators'),
  voiceId: z.string().regex(VOICE_ID_REGEX).optional(),
});

ttsRouter.post('/', async (req, res, next) => {
  const parsed = genericSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await ttsRoute(parsed.data.text, parsed.data.jobId, parsed.data.role, parsed.data.voiceId);
    res.json(result);
  } catch (err) {
    logger.error('tts_failed', { error: String(err) });
    next(err);
  }
});

// Legacy: /tts/edge — minimal compat for Phase 04 quiz workflow before re-import
const legacySchema = z.object({
  text: z.string().min(1).max(500),
  voice: z.enum(VOICE_WHITELIST),
});

ttsRouter.post('/edge', async (req, res, next) => {
  const parsed = legacySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await synthesize(parsed.data.text, parsed.data.voice);
    res.json(result);
  } catch (err) {
    logger.error('tts_edge_failed', { error: String(err) });
    next(err);
  }
});
