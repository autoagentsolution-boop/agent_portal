// Token service — the API the rest of the app uses for OAuth tokens.
// Adapters call getActiveToken(ownerId, platform); the refresh cron calls
// runTokenMaintenance() (walks every tenant's tokens).
import { getToken, upsertToken, markTokenStatus, listAllTokenKeys } from '../db/repos/token-repo.ts';
import { getPublisherPlatformToken } from '../db/repos/agent-credential-repo.ts';
import { logRun } from '../db/client.ts';
import { logger } from '../lib/logger.ts';
import { env } from '../config/env.ts';
import { SYSTEM_OWNER_ID } from '../db/system-owner.ts';
import { providers } from './providers.ts';
import type { PlatformTokenProvider } from './types.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

// The stored-token shape both refresh paths (cron sweep + lazy on-access) consume.
type TokenRecord = {
  token: string;
  refreshToken: string | null;
  expiresAt: Date | null;
  meta: Record<string, unknown> | null;
};

// Refresh a token iff the provider supports it AND expiry is inside the window.
// Persists the fresh token on success. Shared by runTokenMaintenance (cron) and
// getActiveToken (lazy) so there's ONE refresh implementation. Throws only on an
// actual refresh HTTP failure — callers decide how to treat that (cron logs, lazy
// falls back to the existing token).
export const refreshIfDue = async (
  ownerId: string,
  platform: SocialPlatform,
  rec: TokenRecord,
  provider: PlatformTokenProvider,
): Promise<{ token: string; refreshed: boolean }> => {
  if (!provider.refresh || !provider.refreshWhenWithinMs) return { token: rec.token, refreshed: false };
  const within = rec.expiresAt
    ? rec.expiresAt.getTime() - Date.now() <= provider.refreshWhenWithinMs
    : true; // unknown expiry → refresh to be safe
  if (!within) return { token: rec.token, refreshed: false };
  const r = await provider.refresh(rec.token, rec.refreshToken, rec.meta, ownerId);
  await upsertToken({
    ownerId,
    platform,
    token: r.token,
    refreshToken: r.refreshToken ?? rec.refreshToken,
    expiresAt: r.expiresAt,
    meta: rec.meta,
  });
  return { token: r.token, refreshed: true };
};

// Return the current plaintext token for (owner, platform), or throw if
// missing/revoked. Adapters use this instead of reading process.env directly.
export const getActiveToken = async (
  ownerId: string,
  platform: SocialPlatform,
): Promise<string> => {
  // OAuth-first: a live OAuthToken (minted via /connect) always wins — it refreshes.
  const rec = await getToken(ownerId, platform);
  if (rec && rec.status !== 'revoked') {
    // Lazy refresh-ahead: closes the last-minutes gap between cron sweeps (X's window
    // is only 15 min). Best-effort — a refresh hiccup falls through to the existing
    // token so a publish never dies on a transient refresh error; the cron sweep and
    // needs_attention status surface a genuinely dead token.
    const provider = providers[platform];
    if (provider) {
      try {
        const { token } = await refreshIfDue(ownerId, platform, rec, provider);
        return token;
      } catch (e) {
        logger.warn('token_lazy_refresh_failed', { ownerId, platform, error: String(e).slice(0, 200) });
      }
    }
    return rec.token;
  }

  // Fallback: a token entered directly in the Connections form, stored encrypted in
  // the credential vault under publisher/<platform>_access_token. Lets a workspace
  // publish without running the full OAuth app setup (no META_APP_ID etc. required).
  const formToken = await getPublisherPlatformToken(ownerId, platform);
  if (formToken) return formToken;

  if (rec && rec.status === 'revoked') throw new Error(`token: ${platform} revoked, needs re-mint`);
  throw new Error(`token: no token stored for ${platform}`);
};

export const getTokenMeta = async (
  ownerId: string,
  platform: SocialPlatform,
): Promise<Record<string, unknown> | null> => {
  const rec = await getToken(ownerId, platform);
  return rec?.meta ?? null;
};

// One-time seed: import tokens from env into the encrypted DB store for one owner
// (defaults to the system/DAIS owner — env tokens are DAIS's). Idempotent (upsert).
// Real users populate their rows via the connect-flow, not env. meta carries the
// platform identity ids the providers need.
export const seedTokensFromEnv = async (
  ownerId: string = SYSTEM_OWNER_ID,
): Promise<string[]> => {
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
    await upsertToken({ ownerId, platform: p.platform, token: p.token, meta: p.meta ?? null });
    seeded.push(p.platform);
  }
  await logRun('info', 'token_seed', { ownerId, seeded }, ownerId);
  return seeded;
};

// Refresh-ahead-of-expiry + liveness for EVERY stored token across all tenants.
// Idempotent; safe to run on a cron. Returns a per-(owner,platform) summary.
export const runTokenMaintenance = async (): Promise<Record<string, unknown>> => {
  const summary: Record<string, unknown> = {};
  const keys = await listAllTokenKeys();

  for (const { ownerId, platform } of keys) {
    const key = `${ownerId}:${platform}`;
    const provider = providers[platform];
    if (!provider) {
      summary[key] = { skipped: 'no provider' };
      continue;
    }
    const rec = await getToken(ownerId, platform);
    if (!rec) {
      summary[key] = { skipped: 'no token' };
      continue;
    }
    let token = rec.token;
    let refreshed = false;

    // Refresh and liveness are INDEPENDENT: a refresh failure (e.g. LinkedIn tier
    // issues no refresh_token, or a transient error) must NOT flag an otherwise-live
    // token. Only the liveness check sets status. Refresh failure is logged, then we
    // fall through to check the existing token.
    try {
      const r = await refreshIfDue(ownerId, platform, rec, provider);
      token = r.token;
      refreshed = r.refreshed;
    } catch (e) {
      logger.warn('token_refresh_failed', { ownerId, platform, error: String(e).slice(0, 200) });
    }

    try {
      const check = await provider.check(token, rec.meta);
      await markTokenStatus(ownerId, platform, check.alive ? 'active' : 'needs_attention');
      summary[key] = { refreshed, alive: check.alive, identity: check.identity, reason: check.reason };
    } catch (e) {
      await markTokenStatus(ownerId, platform, 'needs_attention');
      summary[key] = { refreshed, error: String(e).slice(0, 200) };
      logger.warn('token_maintenance_error', { ownerId, platform, error: String(e).slice(0, 200) });
    }
  }
  await logRun('info', 'token_maintenance', summary);
  return summary;
};
