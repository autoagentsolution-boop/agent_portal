// JWT auth middleware for user-facing routes. Replaces requireApiKey on the
// tenant-scoped API (api-key stays ONLY on internal cron/webhook s2s in later
// phases). Extracts Bearer token → verifies → attaches userId/userEmail.
import type { Request, Response, NextFunction } from 'express';
import { verifySession } from '../lib/auth-jwt.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
    }
  }
}

const bearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  const token = bearer(req.header('authorization'));
  if (!token) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  const claims = verifySession(token);
  if (!claims) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  req.userId = claims.sub;
  req.userEmail = claims.email;
  next();
};
