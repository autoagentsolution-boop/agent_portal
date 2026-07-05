// Drive connect router (Piece 3). Per-user Google Drive OAuth so generated post images
// get a public lh3 URL that IG/Threads can fetch. Drive is NOT a SocialPlatform, so it
// has its own /start; it does NOT need its own callback redirect.
//
// REDIRECT REUSE: to avoid making the owner register a second redirect URI in the Google
// console (the cause of `redirect_uri_mismatch`), the Drive flow reuses the ALREADY-registered
// login redirect (`GOOGLE_OAUTH_REDIRECT_URI` → /auth/google/callback). The auth callback
// detects a drive-scoped state and delegates to `completeDriveConnect` here. A local
// /connect/drive/callback is kept only as a fallback for anyone who did register it.
//
//   GET /connect/drive/start → requireAuth → 302 to Google consent (drive.file, offline)
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

// Reuse the login redirect (already registered) — see file header.
export const driveRedirectUri = (): string => env.GOOGLE_OAUTH_REDIRECT_URI;

const issueState = (ownerId: string): string =>
  jwt.sign({ ownerId, kind: 'drive', n: randomBytes(8).toString('hex') }, stateSecret(), {
    algorithm: 'HS256',
    expiresIn: STATE_TTL,
  });

// Returns the ownerId if `state` is a valid drive-connect state, else null. Used by the
// shared Google callback to tell a Drive consent apart from an app-login consent.
export const readDriveState = (state: string | undefined): string | null => {
  if (!state) return null;
  try {
    const d = jwt.verify(state, stateSecret(), { algorithms: ['HS256'] }) as { ownerId?: string; kind?: string };
    if (d?.kind !== 'drive' || !d.ownerId) return null;
    return d.ownerId;
  } catch {
    return null;
  }
};

// Exchange the code for a refresh token and store it in the vault. Shared by the login
// callback (reused redirect) and the fallback /connect/drive/callback.
export const completeDriveConnect = async (ownerId: string, code: string): Promise<void> => {
  const { refreshToken } = await exchangeDriveCode(code, driveRedirectUri());
  await savePublisherCredential(ownerId, DRIVE_REFRESH_KEY, refreshToken);
  logger.info('drive_connected', { ownerId });
};

driveConnectRouter.get(
  '/start',
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
      logger.warn('drive_connect_not_configured', {});
      return fail(res, 500, 'drive_not_configured', 'GOOGLE_CLIENT_ID/SECRET not set');
    }
    const url = driveAuthUrl(driveRedirectUri(), issueState(req.userId!));
    res.redirect(url);
  }),
);

// Fallback callback — only reached if the owner registered /connect/drive/callback directly.
// The primary path is the shared /auth/google/callback (no extra redirect to register).
driveConnectRouter.get(
  '/callback',
  asyncHandler(async (req, res) => {
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const ownerId = readDriveState(typeof req.query.state === 'string' ? req.query.state : undefined);
    if (!code) return fail(res, 400, 'missing_code');
    if (!ownerId) return fail(res, 400, 'invalid_state');
    try {
      await completeDriveConnect(ownerId, code);
      res.redirect(`${env.UI_BASE_URL || ''}/?drive=connected`);
    } catch (e) {
      logger.warn('drive_connect_failed', { ownerId, error: String(e).slice(0, 200) });
      return fail(res, 502, 'drive_connect_failed', String(e instanceof Error ? e.message : e).slice(0, 200));
    }
  }),
);
