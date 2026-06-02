import { Router } from 'express';
import { z } from 'zod';
import { synthesize, VOICE_WHITELIST } from '../tts/edge.ts';
import { logger } from '../logger.ts';

export const ttsRouter = Router();

const edgeSchema = z.object({
  text: z.string().min(1).max(500),
  voice: z.enum(VOICE_WHITELIST),
});

ttsRouter.post('/edge', async (req, res, next) => {
  const parsed = edgeSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await synthesize(parsed.data.text, parsed.data.voice);
    res.json(result);
  } catch (err) {
    logger.error('tts_failed', { error: String(err) });
    next(err);
  }
});
