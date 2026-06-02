import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Router } from 'express';
import { z } from 'zod';
import { generate } from '../image/nano-banana.ts';
import { logger } from '../logger.ts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REFERENCE_DIR = path.resolve(__dirname, '..', '..', 'public', 'character-refs');

export const imageRouter = Router();

const schema = z.object({
  prompt: z.string().min(8).max(1500),
  mode: z.enum(['text-to-image', 'edit']),
  referenceImage: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+\.(png|jpg|jpeg|webp)$/, 'reference filename only, no path traversal')
    .optional(),
});

imageRouter.post('/generate', async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  const { prompt, mode, referenceImage } = parsed.data;
  const referenceImagePath = referenceImage ? path.join(REFERENCE_DIR, referenceImage) : undefined;
  try {
    const result = await generate({ prompt, mode, referenceImagePath });
    res.json(result);
  } catch (err) {
    logger.error('image_generate_failed', { error: String(err) });
    next(err);
  }
});
