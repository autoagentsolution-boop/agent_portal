// Auth router — Google login → long-lived app JWT.
//   GET  /auth/google/start    → 302 to Google consent (identity scope only)
//   GET  /auth/google/callback → exchange code, upsert user, issue JWT (JSON)
//   GET  /auth/me              → requireAuth-protected identity echo (verify gate)
//
// CSRF: `state` is a short-lived (10m) HMAC-signed nonce (JWT) — stateless, no
// server store, survives restarts. No refresh token anywhere (plan T1/§4).
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { ok, fail, asyncHandler } from './http.ts';
import { requireAuth } from './middleware-auth.ts';
import { buildConsentUrl, exchangeCodeForIdentity } from '../lib/google-oauth.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { upsertGoogleUser, getUserById } from '../db/repos/user-repo.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

export const authRouter: Router = Router();

const STATE_TTL = '10m';
const stateSecret = (): string => {
  if (!env.JWT_SECRET) throw new Error('auth: JWT_SECRET not set');
  return env.JWT_SECRET;
};

const issueState = (): string =>
  jwt.sign({ n: randomBytes(8).toString('hex') }, stateSecret(), {
    algorithm: 'HS256',
    expiresIn: STATE_TTL,
  });

const stateValid = (state: string | undefined): boolean => {
  if (!state) return false;
  try {
    jwt.verify(state, stateSecret(), { algorithms: ['HS256'] });
    return true;
  } catch {
    return false;
  }
};

authRouter.get(
  '/google/start',
  asyncHandler(async (_req, res) => {
    const url = buildConsentUrl(issueState());
    res.redirect(url);
  }),
);

authRouter.get(
  '/google/callback',
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const state = typeof req.query.state === 'string' ? req.query.state : undefined;
    if (!code) return fail(res, 400, 'missing_code');
    if (!stateValid(state)) return fail(res, 400, 'invalid_state');

    try {
      const identity = await exchangeCodeForIdentity(code);
      const user = await upsertGoogleUser(identity);
      const token = signSession({ sub: user.id, email: user.email });
      logger.info('auth_login', { userId: user.id, email: user.email });
      ok(res, {
        token,
        user: { id: user.id, email: user.email, displayName: user.displayName },
      });
    } catch (e) {
      logger.warn('auth_login_failed', { error: String(e) });
      return fail(res, 401, 'login_failed');
    }
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.userId!);
    if (!user) return fail(res, 404, 'user_not_found');
    ok(res, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      accountType: user.accountType,
      defaultLanguage: user.defaultLanguage,
      role: user.role,
    });
  }),
);
