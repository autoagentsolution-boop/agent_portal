// Auth router — Google login → opaque server-side session (browser) or JWT (CLI).
//   GET  /auth/google/start    → 302 to Google consent (identity scope only)
//   GET  /auth/google/callback → exchange code, upsert user, set HttpOnly session
//                                cookie, 302 → UI (NO token in the URL/response)
//   POST /auth/logout          → revoke the current session cookie
//   GET  /auth/me              → requireAuth-protected identity echo (verify gate)
//
// SECURITY (T8): the browser flow issues an OPAQUE session handle in an HttpOnly
// cookie — the JWT/credential never reaches the client, and the session is
// server-revocable. The JWT path is retained only for the non-browser caller
// (CLI/tests): when UI_BASE_URL is unset the callback falls back to JSON {token}.
// CSRF on login: `state` is a short-lived (10m) HMAC-signed nonce (JWT), stateless.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { ok, fail, asyncHandler } from './http.ts';
import { requireAuth } from './middleware-auth.ts';
import { buildConsentUrl, exchangeCodeForIdentity } from '../lib/google-oauth.ts';
import { signSession } from '../lib/auth-jwt.ts';
import { createSession, revokeSession, sessionTtlMs, SESSION_COOKIE } from '../lib/session.ts';
import { upsertGoogleUser, getUserById } from '../db/repos/user-repo.ts';
import { ensureTrialGrant, getBalance } from '../db/repos/credit-repo.ts';
import { readDriveState, completeDriveConnect } from './drive-connect-router.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

// Cookie attributes. SameSite=Lax allows the top-level OAuth redirect to carry the
// cookie back; Secure in production (HTTPS). HttpOnly = JS can never read it.
const sessionCookieOpts = () => ({
  httpOnly: true as const,
  sameSite: 'lax' as const,
  secure: env.NODE_ENV === 'production',
  maxAge: sessionTtlMs(),
  path: '/',
});

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

    // This redirect is shared with the Drive connect flow (reuses the registered login
    // redirect to avoid a second console registration). A drive-scoped state → store the
    // Drive refresh token for that owner and bounce back to the UI; never a login.
    const driveOwner = readDriveState(state);
    if (driveOwner) {
      try {
        await completeDriveConnect(driveOwner, code);
        return res.redirect(`${env.UI_BASE_URL || ''}/?drive=connected`);
      } catch (e) {
        logger.warn('drive_connect_failed', { ownerId: driveOwner, error: String(e).slice(0, 200) });
        return fail(res, 502, 'drive_connect_failed', String(e instanceof Error ? e.message : e).slice(0, 200));
      }
    }

    if (!stateValid(state)) return fail(res, 400, 'invalid_state');

    try {
      const identity = await exchangeCodeForIdentity(code);
      const user = await upsertGoogleUser(identity);
      // New-tenant trial (credit-wallet Phase 01): idempotent — grants once on first login, no-op after.
      const granted = await ensureTrialGrant(user.id).catch((e) => {
        logger.warn('trial_grant_failed', { userId: user.id, error: String(e).slice(0, 160) });
        return false;
      });
      logger.info('auth_login', { userId: user.id, email: user.email, trialGranted: granted });

      // Browser flow (UI_BASE_URL set): opaque session cookie + redirect, no token
      // anywhere the client can read. This is the path the UI uses.
      if (env.UI_BASE_URL) {
        const { handle } = await createSession(user.id, req.header('user-agent') ?? undefined);
        res.cookie(SESSION_COOKIE, handle, sessionCookieOpts());
        return res.redirect(env.UI_BASE_URL);
      }

      // CLI/test fallback (no UI configured): return the JWT as JSON.
      const token = signSession({ sub: user.id, email: user.email });
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

// Logout — revoke the server-side session and clear the cookie. Idempotent.
authRouter.post(
  '/logout',
  asyncHandler(async (req, res) => {
    await revokeSession(req.cookies?.[SESSION_COOKIE]);
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    ok(res, { loggedOut: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const user = await getUserById(req.userId!);
    if (!user) return fail(res, 404, 'user_not_found');
    // credits = remaining wallet balance (credit-wallet Phase 02) — the top-nav pill reads this.
    const credits = await getBalance(user.id).catch(() => 0);
    ok(res, {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      avatarUrl: user.avatarUrl,
      accountType: user.accountType,
      defaultLanguage: user.defaultLanguage,
      role: user.role,
      isSuperAdmin: user.isSuperAdmin,
      credits,
    });
  }),
);
