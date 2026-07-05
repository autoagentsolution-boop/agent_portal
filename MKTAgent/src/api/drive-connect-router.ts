// Drive connect router (Piece 3). Per-user Google Drive OAuth so generated post images
// get a public lh3 URL that IG/Threads can fetch. Drive is NOT a SocialPlatform, so it
// has its own route family instead of being forced into the social connect enum.
//
//   GET /connect/drive/start    → requireAuth → 302 to Google consent (drive.file, offline)
//   GET /connect/drive/callback → exchange code → store refresh_token in the vault
//
// The callback arrives with NO auth header (Google redirects the browser), so ownerId
// round-trips inside a signed, short-lived state JWT issued at /start — same pattern as
// the social connect-router. Self-contained state (drive-scoped) keeps the working social
// flow untouched.
import { Router } from 'express';
import jwt from 'jsonwebtoken';
import { randomBytes } from 'node:crypto';
import { fail, asyncHandler } from './http.ts';
import { requireAuth } from './middleware-auth.ts';
import { driveAuthUrl, exchangeDriveCode, DRIVE_REFRESH_KEY } from '../assets/drive-client.ts';
import { savePublisherCredential } from '../db/repos/agent-credential-repo.ts';
import { env } from '../config/env.ts';
import { logger } from '../lib/logger.ts';

export const driveConnectRouter: Router = Router();

const STATE_TTL = '10m';

const stateSecret = (): string => {
  if (!env.JWT_SECRET) throw new Error('drive connect: JWT_SECRET not set');
  return env.JWT_SECRET;
};

const redirectUri = (): string => `${env.PUBLIC_BASE_URL}/connect/drive/callback`;

const issueState = (ownerId: string): string =>
  jwt.sign({ ownerId, kind: 'drive', n: randomBytes(8).toString('hex') }, stateSecret(), {
    algorithm: 'HS256',
    expiresIn: STATE_TTL,
  });

const readOwner = (state: string | undefined): string | null => {
  if (!state) return null;
  try {
    const d = jwt.verify(state, stateSecret(), { algorithms: ['HS256'] }) as { ownerId?: string; kind?: string };
    if (d?.kind !== 'drive' || !d.ownerId) return null;
    return d.ownerId;
  } catch {
    return null;
  }
};

driveConnectRouter.get(
  '/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      logger.warn('drive_connect_not_configured', {});
      return fail(res, 500, 'drive_not_configured', 'GOOGLE_CLIENT_ID/SECRET not set');
    }
    const url = driveAuthUrl(redirectUri(), issueState(req.userId!));
    res.redirect(url);
  }),
);

driveConnectRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const ownerId = readOwner(typeof req.query.state === 'string' ? req.query.state : undefined);
    if (!code) return fail(res, 400, 'missing_code');
    if (!ownerId) return fail(res, 400, 'invalid_state');
    try {
      const { refreshToken } = await exchangeDriveCode(code, redirectUri());
      await savePublisherCredential(ownerId, DRIVE_REFRESH_KEY, refreshToken);
      logger.info('drive_connected', { ownerId });
      res.redirect(`${env.UI_BASE_URL || ''}/?drive=connected`);
    } catch (e) {
      logger.warn('drive_connect_failed', { ownerId, error: String(e).slice(0, 200) });
      return fail(res, 502, 'drive_connect_failed', String(e instanceof Error ? e.message : e).slice(0, 200));
    }
  }),
);
