// User (tenant) repository. Identity upsert keys on googleSub — the stable
// Google account subject. A second login with the same sub returns the same row
// (no duplicate tenant); profile fields refresh from Google each login.
import { prisma } from '../client.ts';
import type { User } from '../../../prisma/generated/prisma/client.ts';
import type { GoogleIdentity } from '../../lib/google-oauth.ts';

export const getUserById = (id: string): Promise<User | null> =>
  prisma.user.findUnique({ where: { id } });

// Upsert by googleSub. Email is also unique; if a pre-existing email row has a
// null sub (future email/pw user), we still match on sub and would 409 on the
// email index — acceptable for v1 (Google-login is the only path that writes here).
export const upsertGoogleUser = (identity: GoogleIdentity): Promise<User> =>
  prisma.user.upsert({
    where: { googleSub: identity.googleSub },
    create: {
      email: identity.email,
      googleSub: identity.googleSub,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
    update: {
      email: identity.email,
      displayName: identity.displayName,
      avatarUrl: identity.avatarUrl,
    },
  });
