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

type Drive = ReturnType<typeof google.drive>;

const getDriveForOwner = async (ownerId: string): Promise<Drive> => {
  const refreshToken = await getPublisherAppCred(ownerId, DRIVE_REFRESH_KEY);
  if (!refreshToken) throw new Error('drive: owner has no Drive connected');
  const auth = new google.auth.OAuth2(env.GOOGLE_CLIENT_ID, env.GOOGLE_CLIENT_SECRET);
  auth.setCredentials({ refresh_token: refreshToken });
  return google.drive({ version: 'v3', auth });
};

// Find-or-create a folder by name (optionally under a parent), returning its id. With the
// drive.file scope the app only ever sees the folders it created, so this never touches the
// user's own Drive tree. Cached per (owner, parent, name) to avoid a lookup on every image.
const folderCache = new Map<string, string>();

const ensureFolder = async (ownerId: string, drive: Drive, name: string, parentId?: string): Promise<string> => {
  const cacheKey = `${ownerId}:${parentId ?? 'root'}:${name}`;
  const cached = folderCache.get(cacheKey);
  if (cached) return cached;

  const esc = name.replace(/'/g, "\\'");
  const parentClause = parentId ? ` and '${parentId}' in parents` : '';
  const q = `mimeType='application/vnd.google-apps.folder' and name='${esc}' and trashed=false${parentClause}`;
  const list = await drive.files.list({ q, fields: 'files(id)', pageSize: 1 });
  let id = list.data.files?.[0]?.id ?? null;
  if (!id) {
    const created = await drive.files.create({
      requestBody: {
        name,
        mimeType: 'application/vnd.google-apps.folder',
        ...(parentId ? { parents: [parentId] } : {}),
      },
      fields: 'id',
    });
    id = created.data.id ?? null;
  }
  if (!id) throw new Error(`drive: could not ensure folder ${name}`);
  folderCache.set(cacheKey, id);
  return id;
};

// Resolve the target folder for a campaign's media: MKTAgent/<campaign>. Returns the
// campaign folder id to pass as `parents` on upload. Cached, so repeated posts under the
// same campaign don't re-list.
export const resolveCampaignFolder = async (ownerId: string, campaignName: string): Promise<string> => {
  const drive = await getDriveForOwner(ownerId);
  const root = await ensureFolder(ownerId, drive, 'MKTAgent');
  const safe = (campaignName || '').trim().slice(0, 80) || 'Uncategorized';
  return ensureFolder(ownerId, drive, safe, root);
};

// Upload one local image file to the owner's Drive, make it anyone-with-link readable
// (so Meta can fetch the lh3 URL), and return the Drive fileId. `folderId` targets a
// campaign folder; `name` carries an ordering prefix so files sort correctly in Drive too.
// Throws on any failure — the caller (publish materialization) decides how to degrade.
export const uploadImageToDrive = async (
  ownerId: string,
  filePath: string,
  opts: { folderId?: string; name?: string } = {},
): Promise<string> => {
  const drive = await getDriveForOwner(ownerId);
  const created = await drive.files.create({
    media: { body: createReadStream(filePath) },
    requestBody: {
      name: opts.name ?? basename(filePath),
      ...(opts.folderId ? { parents: [opts.folderId] } : {}),
    },
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
    // drive.file → media storage (P3); gmail.send → the Email Agent nurtures leads from the owner's
    // own Gmail (P2-2c), no third-party ESP; gmail.readonly → Lead Nurture Agent Phase 02 reads lead
    // replies (nurture/gmail-read.ts), scoped by nurture-reply-poller.ts to ONLY the Gmail threads we
    // started. One Google connect covers all three (decision 4: keep-Google). Users who connected
    // BEFORE a scope was added must reconnect to grant it — the affected feature fails loud/degrades
    // gracefully (see hasGmailReadScope) until then, it never silently no-ops.
    scope: [
      'https://www.googleapis.com/auth/drive.file',
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
    ],
    state,
  });
};
