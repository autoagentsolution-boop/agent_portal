import { Router } from 'express';
import { z } from 'zod';
import { preflightCost } from '../util/cost-cap.ts';
import { logger } from '../logger.ts';

export const preflightRouter = Router();

const schema = z.object({
  estimatedCostUsd: z.number().min(0).max(100),
});

preflightRouter.post('/cost', async (req, res, next) => {
  const parsed = schema.safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: 'invalid_payload', issues: parsed.error.flatten() });
    return;
  }
  try {
    const result = await preflightCost(parsed.data.estimatedCostUsd);
    if (!result.ok) logger.warn('cost_cap_hit', { ...result });
    res.json(result);
  } catch (err) {
    logger.error('preflight_failed', { error: String(err) });
    next(err);
  }
});
