// Connect router — per-user social account OAuth (T4). Lets a logged-in tenant
// link their OWN FB/IG/Threads/LinkedIn/X account; the resulting token lands in
// the encrypted store under (req.userId, platform), so their scheduled posts
// publish as them — not DAIS.
//
//   GET /connect/:platform/start    → requireAuth → 302 to platform consent
//   GET /connect/:platform/callback → exchange code → encrypted per-user token
//
// The callback arrives with NO auth header (the platform redirects the browser),
// so ownerId + the PKCE verifier round-trip inside a signed, short-lived state JWT
// issued at /start (which IS requireAuth). Stateless, survives restarts — same
// pattern as the Google-login state nonce.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes, createHash } from 'node:crypto';
import { ok, fail, asyncHandler } from './http.ts';
import { requireAuth } from './middleware-auth.ts';
import { connectProviders } from '../social/connect-providers.ts';
import { upsertToken } from '../db/repos/token-repo.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export const connectRouter: Router = Router();

const STATE_TTL = '10m';
const PLATFORMS = new Set<SocialPlatform>(['facebook', 'instagram', 'threads', 'linkedin', 'x']);

const stateSecret = (): string => {
  if (!env.JWT_SECRET) throw new Error('connect: JWT_SECRET not set');
  return env.JWT_SECRET;
};

interface ConnectState {
  ownerId: string;
  platform: SocialPlatform;
  pkce?: string; // code_verifier (X only)
}

const issueState = (payload: ConnectState): string =>
  jwt.sign({ ...payload, n: randomBytes(8).toString('hex') }, stateSecret(), {
    algorithm: 'HS256',
    expiresIn: STATE_TTL,
  });

const readState = (state: string | undefined): ConnectState | null => {
  if (!state) return null;
  try {
    const d = jwt.verify(state, stateSecret(), { algorithms: ['HS256'] }) as ConnectState;
    if (!d?.ownerId || !PLATFORMS.has(d.platform)) return null;
    return d;
  } catch {
    return null;
  }
};

const parsePlatform = (raw: string): SocialPlatform | null =>
  PLATFORMS.has(raw as SocialPlatform) ? (raw as SocialPlatform) : null;

// Per-(owner,platform) callback URI. Must byte-match the value registered in each
// platform's app console. Absolute (platforms reject relative redirect_uri).
const redirectUri = (platform: SocialPlatform): string =>
  `${env.PUBLIC_BASE_URL}/connect/${platform}/callback`;

// PKCE (X): code_verifier → S256 challenge.
const pkceChallenge = (verifier: string): string =>
  createHash('sha256').update(verifier).digest('base64url');

connectRouter.get(
  '/:platform/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    const platform = parsePlatform(req.params.platform);
    if (!platform) return fail(res, 404, 'unknown_platform');
    const provider = connectProviders[platform];
    try {
      provider.assertConfigured();
    } catch (e) {
      // App creds not provisioned yet — external-onboarding gate, not a code bug.
      logger.warn('connect_not_configured', { platform, error: String(e) });
      return fail(res, 500, 'connect_not_configured', String(e instanceof Error ? e.message : e));
    }

    const verifier = provider.usesPkce ? randomBytes(32).toString('base64url') : undefined;
    const state = issueState({ ownerId: req.userId!, platform, pkce: verifier });
    const url = provider.buildAuthUrl(
      redirectUri(platform),
      state,
      verifier ? pkceChallenge(verifier) : undefined,
    );
    res.redirect(url);
  }),
);

connectRouter.get(
  '/:platform/callback',
  asyncHandler(async (req, res) => {
    const platform = parsePlatform(req.params.platform);
    if (!platform) return fail(res, 404, 'unknown_platform');

    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const st = readState(typeof req.query.state === 'string' ? req.query.state : undefined);
    if (!code) return fail(res, 400, 'missing_code');
    if (!st) return fail(res, 400, 'invalid_state');
    // State binds the flow to one platform — a mismatched path is tampering.
    if (st.platform !== platform) return fail(res, 400, 'platform_mismatch');

    const provider = connectProviders[platform];
    try {
      const ex = await provider.exchangeCode(code, redirectUri(platform), st.pkce);
      await upsertToken({
        ownerId: st.ownerId,
        platform,
        token: ex.token,
        refreshToken: ex.refreshToken ?? null,
        expiresAt: ex.expiresAt ?? null,
        status: 'active',
        meta: ex.meta ?? null,
      });
      logger.info('connect_linked', { ownerId: st.ownerId, platform });
      ok(res, { platform, connected: true });
    } catch (e) {
      logger.warn('connect_failed', { ownerId: st.ownerId, platform, error: String(e).slice(0, 200) });
      return fail(res, 502, 'connect_exchange_failed', String(e instanceof Error ? e.message : e).slice(0, 200));
    }
  }),
);
