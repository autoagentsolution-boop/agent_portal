// User (tenant) repository. Identity upsert keys on googleSub — the stable
// Google account subject. A second login with the same sub returns the same row
// (no duplicate tenant); profile fields refresh from Google each login.
import { prisma } from '../client.ts';
import type { User } from '../../../prisma/generated/prisma/client.ts';
import type { GoogleIdentity } from '../../lib/google-oauth.ts';

export const getUserById = (id: string): Promise<User | null> =>
  prisma.user.findUnique({ where: { id } });

// Lead Nurture Agent (Phase 01) — the per-owner auto-enroll toggle (default OFF). No route wires this
// yet (Phase 04 UI); exposed here so it exists as a single write-point and the verify script can flip
// it for a test tenant.
export const setNurtureEnabled = (id: string, enabled: boolean): Promise<User> =>
  prisma.user.update({ where: { id }, data: { nurtureEnabled: enabled } });

// Nurture Inbox owner settings (Phase 04): the on/off toggle + cadence shape (maxTouches/gapDays,
// snapshotted into a fresh thread's sequenceId at enroll time — see sequence.ts buildSequence). All
// three fields are optional so PUT /nurture/settings can patch just the toggle without also having to
// resend the cadence, or vice versa.
export interface NurtureSettingsPatch { enabled?: boolean; maxTouches?: number; gapDays?: number }
export const setNurtureSettings = (id: string, patch: NurtureSettingsPatch): Promise<User> =>
  prisma.user.update({
    where: { id },
    data: {
      ...(patch.enabled !== undefined ? { nurtureEnabled: patch.enabled } : {}),
      ...(patch.maxTouches !== undefined ? { nurtureMaxTouches: patch.maxTouches } : {}),
      ...(patch.gapDays !== undefined ? { nurtureGapDays: patch.gapDays } : {}),
    },
  });

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
