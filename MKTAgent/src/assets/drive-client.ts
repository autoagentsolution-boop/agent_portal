// Per-user Google Drive upload (Piece 3). Orchestration generates post images to
// local disk (`local:<path>`); IG/Threads need a PUBLIC url Meta can fetch server-side.
// This uploads a local image to the owner's Drive and returns a fileId whose lh3 CDN
// URL (`DriveAssetStore.publicUrl`) is publicly reachable — so IG/Threads publish works
// from localhost with no public host / tunnel.
//
// The refresh_token is minted by drive-connect-router and stored encrypted in the vault
// under (ownerId, 'publisher', 'google_drive_refresh_token'). google.auth.OAuth2 refreshes
// the short-lived access token internally (same as leads/notify.ts) → Drive needs NO
// token-cron entry. Scope is drive.file (non-sensitive): the app only ever sees files it
// created, never the user's existing Drive.
import { google } from 'googleapis';
import { createReadStream } from 'node:fs';
import { basename } from 'node:path';
import { env } from '../config/env.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';

// Vault key holding the per-user Drive refresh token. Kept distinct from the env-based
// Gmail `google_refresh_token` so Drive connect and Gmail notify never collide.
export const DRIVE_REFRESH_KEY = 'google_drive_refresh_token';

export const hasDriveConnected = async (ownerId: string): Promise<boolean> =>
  Boolean(await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY));

const getDriveForOwner = async (ownerId: string) => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) throw new Error('drive: owner has no Drive connected');
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
};

// Upload one local image file to the owner's Drive, make it anyone-with-link readable
// (so Meta can fetch the lh3 URL), and return the Drive fileId. Throws on any failure —
// the caller (publish materialization) decides how to degrade.
export const uploadImageToDrive = async (ownerId: string, filePath: string): Promise<string> => {
  const drive = await getDriveForOwner(ownerId);
  const created = await drive.files.create({
    media: { body: createReadStream(filePath) },
    requestBody: { name: basename(filePath) },
    fields: 'id',
  });
  const fileId = created.data.id;
  if (!fileId) throw new Error('drive: upload returned no file id');
  // Public reader: images are marketing assets meant to be fetched by IG/Threads.
  await drive.permissions.create({ fileId, requestBody: { role: 'reader', type: 'anyone' } });
  return fileId;
};

// Exchange an authorization code for tokens (used by drive-connect-router's callback).
// Returns the refresh_token to persist. `redirectUri` must byte-match the console reg.
export const exchangeDriveCode = async (
  code: string,
  redirectUri: string,
): Promise<{ refreshToken: string }> => {
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  const { tokens } = await auth.getToken(code);
  if (!tokens.refresh_token) {
    // No refresh_token → the user previously granted consent (Google only returns it on
    // first consent). prompt=consent in the auth url forces a fresh one; surface clearly.
    throw new Error('drive: no refresh_token returned (revoke prior access or use prompt=consent)');
  }
  return { refreshToken: tokens.refresh_token };
};

// Consent URL for the Drive connect flow. offline + consent guarantees a refresh_token.
export const driveAuthUrl = (redirectUri: string, state: string): string => {
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET, redirectUri);
  return auth.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/drive.file'],
    state,
  });
};
