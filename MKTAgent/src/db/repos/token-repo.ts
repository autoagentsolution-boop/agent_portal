// OAuth token repository — encrypts on write, decrypts on read. The rest of the
// app never sees ciphertext; the DB never sees plaintext.
import { prisma } from '../client.ts';
import { encryptToken, decryptToken } from '../../lib/crypto.ts';
import type { SocialPlatform, TokenStatus } from '../../../prisma/generated/prisma/client.ts';

export interface TokenRecord {
  platform: SocialPlatform;
  token: string; // plaintext (decrypted)
  refreshToken: string | null;
  expiresAt: Date | null;
  status: TokenStatus;
  meta: Record<string, unknown> | null;
}

export const upsertToken = async (input: {
  platform: SocialPlatform;
  token: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  status?: TokenStatus;
  meta?: Record<string, unknown> | null;
}): Promise<void> => {
  const enc = encryptToken(input.token);
  const encRefresh = input.refreshToken ? encryptToken(input.refreshToken) : null;
  await prisma.oAuthToken.upsert({
    where: { platform: input.platform },
    create: {
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

export const getToken = async (platform: SocialPlatform): Promise<TokenRecord | null> => {
  const row = await prisma.oAuthToken.findUnique({ where: { platform } });
  if (!row) return null;
  return {
    platform: row.platform,
    token: decryptToken(row.token),
    refreshToken: row.refreshToken ? decryptToken(row.refreshToken) : null,
    expiresAt: row.expiresAt,
    status: row.status,
    meta: (row.meta as Record<string, unknown> | null) ?? null,
  };
};

export const markTokenStatus = async (
  platform: SocialPlatform,
  status: TokenStatus,
): Promise<void> => {
  await prisma.oAuthToken.update({
    where: { platform },
    data: { status, lastCheckedAt: new Date() },
  });
};
