// OAuth token repository — encrypts on write, decrypts on read. The rest of the
// app never sees ciphertext; the DB never sees plaintext.
// T4: per-user. Every fn is keyed by the composite PK (ownerId, platform); a
// missing ownerId is a compile error (same explicit-arg rule as T2 tenancy).
import { prisma } from '../client.ts';
import { encryptedDbVault } from '../../connectors/vault/encrypted-db-vault.ts';
import type { SocialPlatform, TokenStatus } from '../../../prisma/generated/prisma/client.ts';

// Secret sealing goes through the Credential Vault (§11.2). The MVP impl is the
// encrypted-DB vault (AES-256-GCM ciphertext stored inline) — swapping to an external
// vault later is a one-line change here, not a callsite sweep.
const vault = encryptedDbVault;

export interface TokenRecord {
  ownerId: string;
  platform: SocialPlatform;
  token: string; // plaintext (decrypted)
  refreshToken: string | null;
  expiresAt: Date | null;
  status: TokenStatus;
  meta: Record<string, unknown> | null;
}

export const upsertToken = async (input: {
  ownerId: string;
  platform: SocialPlatform;
  token: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  status?: TokenStatus;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  const enc = await vault.seal(input.token);
  const encRefresh = input.refreshToken ? await vault.seal(input.refreshToken) : null;
  await prisma.oAuthToken.upsert({
    where: { ownerId_platform: { ownerId: input.ownerId, platform: input.platform } },
    create: {
      ownerId: input.ownerId,
      platform: input.platform,
      token: enc,
      refreshToken: encRefresh,
      expiresAt: input.expiresAt ?? null,
      status: input.status ?? 'active',
      meta: (input.meta ?? undefined) as object | undefined,
    },
    update: {
      token: enc,
      refreshToken: encRefresh,
      expiresAt: input.expiresAt ?? null,
      ...(input.status ? { status: input.status } : {}),
      ...(input.meta ? { meta: input.meta as object } : {}),
    },
  });
};

export const getToken = async (
  ownerId: string,
  platform: SocialPlatform,
): Promise<TokenRecord | null> => {
  const row = await prisma.oAuthToken.findUnique({
    where: { ownerId_platform: { ownerId, platform } },
  });
  if (!row) return null;
  return {
    ownerId: row.ownerId,
    platform: row.platform,
    token: await vault.open(row.token),
    refreshToken: row.refreshToken ? await vault.open(row.refreshToken) : null,
    expiresAt: row.expiresAt,
    status: row.status,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
  };
};

export const markTokenStatus = async (
  ownerId: string,
  platform: SocialPlatform,
  status: TokenStatus,
): Promise<void> => {
  await prisma.oAuthToken.update({
    where: { ownerId_platform: { ownerId, platform } },
    data: { status, lastCheckedAt: new Date() },
  });
};

// All stored tokens across every tenant — the maintenance cron walks these.
// Returns identity only (owner, platform); the cron re-reads each via getToken.
export const listAllTokenKeys = (): Promise<Array<{ ownerId: string; platform: SocialPlatform }>> =>
  prisma.oAuthToken.findMany({ select: { ownerId: true, platform: true } });

// Owner-scoped connection status, for the read-only Connections panel. Returns
// metadata ONLY (no token/refresh ciphertext or plaintext) — the secret never
// leaves this layer. Used by GET /connections.
export interface TokenStatusRow {
  platform: SocialPlatform;
  status: TokenStatus;
  expiresAt: Date | null;
  lastCheckedAt: Date | null;
}

export const listTokenStatusForOwner = (ownerId: string): Promise<TokenStatusRow[]> =>
  prisma.oAuthToken.findMany({
    where: { ownerId },
    select: { platform: true, status: true, expiresAt: true, lastCheckedAt: true },
  });
