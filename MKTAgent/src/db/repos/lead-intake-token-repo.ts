// Lead intake token repo (Atria Lead Collector §01.1). A per-owner secret an external funnel
// presents at /leads/* → resolves to the owner. Only the SHA-256 HASH is persisted; the
// plaintext is returned once at creation and never stored (same discipline as OAuth tokens).
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../client.ts';
import type { LeadIntakeToken } from '../../../prisma/generated/prisma/client.ts';

// Opaque, URL-safe token. `atk_` prefix makes it greppable/identifiable in logs-as-a-label
// (the value itself is never logged). 32 random bytes = 256 bits of entropy.
const mintToken = (): string => `atk_${randomBytes(32).toString('base64url')}`;
export const hashIntakeToken = (plaintext: string): string =>
  createHash('sha256').update(plaintext).digest('hex');

export interface CreatedIntakeToken {
  id: string;
  token: string; // plaintext — shown ONCE, caller must surface it immediately
  label: string | null;
  createdAt: Date;
}

export const createIntakeToken = async (ownerId: string, label?: string | null): Promise<CreatedIntakeToken> => {
  const token = mintToken();
  const row = await prisma.leadIntakeToken.create({
    data: { ownerId, tokenHash: hashIntakeToken(token), label: label?.slice(0, 120) || null },
  });
  return { id: row.id, token, label: row.label, createdAt: row.createdAt };
};

// Metadata only — never the hash or plaintext. For the management UI/list.
export const listIntakeTokens = (ownerId: string): Promise<LeadIntakeToken[]> =>
  prisma.leadIntakeToken.findMany({ where: { ownerId }, orderBy: { createdAt: 'desc' } });

// Resolve a presented plaintext token → ownerId (active tokens only). Touches lastUsedAt
// best-effort. Returns null when unknown/revoked → the router maps that to 401.
export const resolveOwnerByToken = async (plaintext: string): Promise<string | null> => {
  if (!plaintext) return null;
  const row = await prisma.leadIntakeToken.findFirst({
    where: { tokenHash: hashIntakeToken(plaintext), active: true },
    select: { id: true, ownerId: true },
  });
  if (!row) return null;
  await prisma.leadIntakeToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => {});
  return row.ownerId;
};

// Owner-scoped revoke (soft — keep the row for audit, flip active off). Returns false on miss.
export const revokeIntakeToken = async (id: string, ownerId: string): Promise<boolean> => {
  const r = await prisma.leadIntakeToken.updateMany({ where: { id, ownerId }, data: { active: false } });
  return r.count === 1;
};
