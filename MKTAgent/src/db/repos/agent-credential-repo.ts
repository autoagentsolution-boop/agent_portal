// Agent credential read helpers. The write path lives inline in agent-router.ts
// (encrypt + upsert); this module owns the READ side so both the token service
// (publish-time fallback) and the connections view can resolve a stored value
// without duplicating the decrypt call. Never logs or returns the plaintext except
// to the direct caller that needs it to authenticate an outbound request.
import { prisma } from '../client.ts';
import { decryptToken, encryptToken } from '../../lib/crypto.ts';
import type { SocialPlatform } from '../../../prisma/generated/prisma/client.ts';

// Encrypt + upsert a publisher-agent credential. Sibling of the inline write in
// agent-router (the HTTP path, which enforces the allowlist first). Used by server-side
// flows that mint a credential directly — e.g. the Drive OAuth callback storing a
// refresh_token. Value is encrypted at rest (AES-256-GCM); never logged.
export const savePublisherCredential = async (
  ownerId: string,
  key: string,
  value: string,
): Promise<void> => {
  await prisma.agentCredential.upsert({
    where: { ownerId_agentId_key: { ownerId, agentId: 'publisher', key } },
    update: { value: encryptToken(value), status: 'active' },
    create: { ownerId, agentId: 'publisher', key, value: encryptToken(value), status: 'active' },
  });
};

// The publisher-agent credential key that holds a platform's access token, entered
// via the Connections form (the OAuth-less path). Mirrors the agent-router allowlist.
export const platformTokenKey = (platform: SocialPlatform): string => `${platform}_access_token`;

// Decrypted access token stored under publisher/<platform>_access_token, or null.
export const getPublisherPlatformToken = async (
  ownerId: string,
  platform: SocialPlatform,
): Promise<string | null> => {
  const cred = await prisma.agentCredential.findUnique({
    where: { ownerId_agentId_key: { ownerId, agentId: 'publisher', key: platformTokenKey(platform) } },
  });
  if (!cred || cred.status !== 'active') return null;
  try {
    return decryptToken(cred.value);
  } catch {
    return null; // corrupt/rotated key material — treat as no credential, not a crash
  }
};

// Generic decrypted read for any publisher-agent credential key (e.g. app client
// id/secret entered via the Connections form, or the Drive refresh token). Sibling
// of getPublisherPlatformToken; both live under agentId 'publisher'. Returns null on
// missing/inactive/corrupt so callers can vault-first, env-fallback without a crash.
export const getPublisherAppCred = async (
  ownerId: string,
  key: string,
): Promise<string | null> => {
  const cred = await prisma.agentCredential.findUnique({
    where: { ownerId_agentId_key: { ownerId, agentId: 'publisher', key } },
  });
  if (!cred || cred.status !== 'active') return null;
  try {
    return decryptToken(cred.value);
  } catch {
    return null;
  }
};

// Which platforms have a form-entered access token (metadata only, no values). Used
// by the connections view to show `connected` for OAuth-less form credentials.
export const listPublisherPlatformTokenKeys = async (ownerId: string): Promise<Set<string>> => {
  const rows = await prisma.agentCredential.findMany({
    where: { ownerId, agentId: 'publisher', status: 'active' },
    select: { key: true },
  });
  return new Set(rows.map((r) => r.key));
};
