// Token service — the API the rest of the app uses for OAuth tokens.
// Adapters call getActiveToken(); the refresh cron calls runTokenMaintenance().
import { getToken, upsertToken, markTokenStatus } from '../db/repos/token-repo.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { env } from '../config/env.ts';
import { providers } from './providers.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

// Return the current plaintext token for a platform, or throw if missing/revoked.
// Adapters use this instead of reading process.env directly.
export const getActiveToken = async (platform: SocialPlatform): Promise<string> => {
  const rec = await getToken(platform);
  if (!rec) throw new Error(`token: no token stored for ${platform}`);
  if (rec.status === 'revoked') throw new Error(`token: ${platform} revoked, needs re-mint`);
  return rec.token;
};

export const getTokenMeta = async (
  platform: SocialPlatform,
): Promise<Record<string, unknown> | null> => {
  const rec = await getToken(platform);
  return rec?.meta ?? null;
};

// One-time seed: import tokens from env into the encrypted DB store. Idempotent
// (upsert). Run on first boot / after re-minting a token in env. meta carries the
// platform identity ids the providers need.
export const seedTokensFromEnv = async (): Promise<string[]> => {
  const seeded: string[] = [];
  const plan: Array<{
    platform: SocialPlatform;
    token: string;
    meta?: Record<string, unknown>;
  }> = [
    { platform: 'facebook', token: env.MKT_FB_PAGE_ACCESS_TOKEN, meta: { pageId: env.MKT_FB_PAGE_ID } },
    { platform: 'instagram', token: env.MKT_IG_ACCESS_TOKEN, meta: { userId: env.MKT_IG_USER_ID } },
    { platform: 'threads', token: env.MKT_THREADS_ACCESS_TOKEN, meta: { userId: env.MKT_THREADS_USER_ID } },
    { platform: 'linkedin', token: env.MKT_LINKEDIN_ACCESS_TOKEN, meta: { personId: env.MKT_LINKEDIN_PERSON_ID } },
    { platform: 'x', token: env.MKT_X_ACCESS_TOKEN },
  ];
  for (const p of plan) {
    if (!p.token) continue;
    await upsertToken({ platform: p.platform, token: p.token, meta: p.meta ?? null });
    seeded.push(p.platform);
  }
  await logRun('info', 'token_seed', { seeded });
  return seeded;
};

// Refresh-ahead-of-expiry + liveness for every stored token. Idempotent; safe to
// run on a cron. Returns a per-platform summary.
export const runTokenMaintenance = async (): Promise<Record<string, unknown>> => {
  const summary: Record<string, unknown> = {};
  for (const platform of Object.keys(providers) as SocialPlatform[]) {
    const provider = providers[platform]!;
    const rec = await getToken(platform);
    if (!rec) {
      summary[platform] = { skipped: 'no token' };
      continue;
    }
    let token = rec.token;
    let refreshed = false;

    try {
      // Refresh if the provider supports it and we're inside the window.
      if (provider.refresh && provider.refreshWhenWithinMs) {
        const within = rec.expiresAt
          ? rec.expiresAt.getTime() - Date.now() <= provider.refreshWhenWithinMs
          : true; // unknown expiry → refresh to be safe
        if (within) {
          const r = await provider.refresh(token, rec.refreshToken, rec.meta);
          await upsertToken({
            platform,
            token: r.token,
            refreshToken: r.refreshToken ?? rec.refreshToken,
            expiresAt: r.expiresAt,
            meta: rec.meta,
          });
          token = r.token;
          refreshed = true;
        }
      }

      const check = await provider.check(token, rec.meta);
      await markTokenStatus(platform, check.alive ? 'active' : 'needs_attention');
      summary[platform] = { refreshed, alive: check.alive, identity: check.identity, reason: check.reason };
    } catch (e) {
      await markTokenStatus(platform, 'needs_attention');
      summary[platform] = { refreshed, error: String(e).slice(0, 200) };
      logger.warn('token_maintenance_error', { platform, error: String(e).slice(0, 200) });
    }
  }
  await logRun('info', 'token_maintenance', summary);
  return summary;
};
