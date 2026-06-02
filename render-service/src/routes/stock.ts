import { Router } from 'express';
import { z } from 'zod';
import { searchAndDownload } from '../stock/pexels.ts';
import { logger } from '../logger.ts';

export const stockRouter = Router();

const schema = z.object({
  keywords: z.array(z.string().min(2).max(80)).min(1).max(8),
  orientation: z.enum(['portrait', 'landscape', 'square']).default('portrait'),
});

stockRouter.post('/pexels', async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await searchAndDownload(parsed.data.keywords, parsed.data.orientation);
    res.json(result);
  } catch (err) {
    logger.error('stock_failed', { error: String(err) });
    next(err);
  }
});
