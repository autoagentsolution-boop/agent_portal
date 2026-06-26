// API-key auth middleware for REST + webhook routes. Keys come from env
// MKT_API_KEYS (comma-separated). Constant-time compare against each.
import type { Request, Response, NextFunction } from 'express';
import { apiKeys } from '../config/env.ts';
import { safeEqual } from './crypto.ts';

export const requireApiKey = (req: Request, res: Response, next: NextFunction): void => {
  const presented = req.header('x-api-key') ?? '';
  if (apiKeys.size === 0) {
    res.status(503).json({ error: 'api_keys_not_configured' });
    return;
  }
  for (const key of apiKeys) {
    if (safeEqual(presented, key)) {
      next();
      return;
    }
  }
  res.status(401).json({ error: 'unauthorized' });
};
