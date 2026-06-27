// Auth middleware for user-facing routes. Two credential paths, in order:
//   1. Bearer JWT  (Authorization header) — CLI / tests / service-to-service.
//   2. Session cookie (T8 BFF)            — the browser UI; opaque handle, the
//      JWT never reaches the client. See lib/session.ts.
// Either resolves to req.userId; absence/invalidity → 401 (reason never leaked).
import type { Request, Response, NextFunction } from 'express';
import { verifySession } from '../lib/auth-jwt.ts';
import { resolveSession, SESSION_COOKIE } from '../lib/session.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId?: string;
      userEmail?: string;
      // Populated by cookie-parser (mounted in server.ts).
      cookies?: Record<string, string>;
    }
  }
}

const bearer = (header: string | undefined): string | null => {
  if (!header) return null;
  const [scheme, token] = header.split(' ');
  return scheme === 'Bearer' && token ? token : null;
};

// Resolve a request's identity from Bearer JWT first, then the session cookie.
// Returns userId or null. Exported so SSE (header OR query) can reuse the cookie
// path without duplicating the lookup.
export const resolveRequestOwner = async (req: Request): Promise<string | null> => {
  const token = bearer(req.header('authorization'));
  if (token) {
    const claims = verifySession(token);
    if (claims) {
      req.userEmail = claims.email;
      return claims.sub;
    }
  }
  const cookieHandle = req.cookies?.[SESSION_COOKIE];
  return resolveSession(cookieHandle);
};

export const requireAuth = (req: Request, res: Response, next: NextFunction): void => {
  void resolveRequestOwner(req)
    .then((ownerId) => {
      if (!ownerId) {
        res.status(401).json({ error: 'unauthorized' });
        return;
      }
      req.userId = ownerId;
      next();
    })
    .catch(() => res.status(401).json({ error: 'unauthorized' }));
};
