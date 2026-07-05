// Per-platform token providers (liveness + optional refresh). Endpoints ported
// verbatim from the n8n mkt-meta-token-refresh workflow + the X OAuth2 model.
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import { getPublisherAppCred } from '../db/repos/agent-credential-repo.ts';
import type { PlatformTokenProvider, TokenCheckResult, RefreshResult } from './types.ts';
import { DAY_MS } from './types.ts';

// Resolve an app credential vault-first (per-user, set via the Connections form),
// env-fallback (DAIS/system default). ownerId absent → env only.
const appCred = async (ownerId: string | undefined, vaultKey: string, envVal: string): Promise<string> => {
  if (ownerId) {
    const v = await getPublisherAppCred(ownerId, vaultKey);
    if (v) return v;
  }
  return envVal;
};

const G = env.GRAPH_VERSION;

const getJson = async (url: string): Promise<any> => {
  const res = await withRetry(() => fetch(url), { label: 'token_http' });
  return res.json();
};

// FB Page token: never-expires (System User). Liveness only — /me must return
// the PAGE (code 190 ⇒ dead). No refresh.
const facebook: PlatformTokenProvider = {
  platform: 'facebook',
  async check(token): Promise<TokenCheckResult> {
    const j = await getJson(`https://graph.facebook.com/${G}/me?fields=id,name&access_token=${encodeURIComponent(token)}`);
    if (j?.error) return { alive: false, reason: j.error.message ?? `code ${j.error.code}` };
    return { alive: Boolean(j?.id), identity: j?.name };
  },
};

// IG publishes via graph.facebook.com/{ig-user-id} using the shared page token.
const instagram: PlatformTokenProvider = {
  platform: 'instagram',
  async check(token, meta): Promise<TokenCheckResult> {
    const igUserId = (meta?.userId as string) || env.MKT_IG_USER_ID;
    if (!igUserId) return { alive: false, reason: 'IG user id missing' };
    const j = await getJson(`https://graph.facebook.com/${G}/${igUserId}?fields=id,username&access_token=${encodeURIComponent(token)}`);
    if (j?.error) return { alive: false, reason: j.error.message ?? `code ${j.error.code}` };
    return { alive: Boolean(j?.id), identity: j?.username };
  },
};

// Threads: long-lived 60d token, refreshed via th_refresh_token. Refresh <7d out.
const threads: PlatformTokenProvider = {
  platform: 'threads',
  refreshWhenWithinMs: 7 * DAY_MS,
  async check(token, meta): Promise<TokenCheckResult> {
    const userId = (meta?.userId as string) || env.MKT_THREADS_USER_ID;
    const j = await getJson(`https://graph.threads.net/${env.THREADS_VERSION}/me?fields=id,username&access_token=${encodeURIComponent(token)}`);
    if (j?.error) return { alive: false, reason: j.error.message ?? 'threads check failed' };
    return { alive: Boolean(j?.id ?? userId), identity: j?.username };
  },
  async refresh(token): Promise<RefreshResult> {
    const j = await getJson(`https://graph.threads.net/refresh_access_token?grant_type=th_refresh_token&access_token=${encodeURIComponent(token)}`);
    if (j?.error || !j?.access_token) {
      throw new Error(`threads refresh failed: ${j?.error?.message ?? 'no access_token'}`);
    }
    const expiresIn = Number(j.expires_in ?? 0);
    return {
      token: j.access_token,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  },
};

// LinkedIn: 60d access token (+365d refresh). Liveness via /v2/userinfo. Refresh via
// standard grant_type=refresh_token — only fires when the connect issued a refresh_token
// (depends on the app tier / r_liveness offline scope). No refresh_token → refresh throws,
// runTokenMaintenance logs it WITHOUT downgrading status; liveness still decides active.
const linkedin: PlatformTokenProvider = {
  platform: 'linkedin',
  refreshWhenWithinMs: 10 * DAY_MS,
  async check(token): Promise<TokenCheckResult> {
    const res = await withRetry(
      () => fetch('https://api.linkedin.com/v2/userinfo', { headers: { Authorization: `Bearer ${token}` } }),
      { label: 'li_check' },
    );
    if (!res.ok) return { alive: false, reason: `userinfo ${res.status}` };
    const j = (await res.json()) as any;
    return { alive: Boolean(j?.sub), identity: j?.name ?? j?.sub };
  },
  async refresh(_token, refreshToken, _meta, ownerId): Promise<RefreshResult> {
    if (!refreshToken) throw new Error('linkedin refresh: no refresh_token (app tier issues none — liveness only)');
    const clientId = await appCred(ownerId, 'linkedin_client_id', env.LINKEDIN_CLIENT_ID);
    const clientSecret = await appCred(ownerId, 'linkedin_client_secret', env.LINKEDIN_CLIENT_SECRET);
    if (!clientId || !clientSecret) throw new Error('linkedin refresh: client id/secret not set');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    });
    const res = await withRetry(
      () => fetch('https://www.linkedin.com/oauth/v2/accessToken', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      }),
      { label: 'li_refresh' },
    );
    const j = (await res.json()) as any;
    if (!res.ok || !j?.access_token) throw new Error(`linkedin refresh failed: ${res.status} ${j?.error ?? ''}`);
    const expiresIn = Number(j.expires_in ?? 0);
    return {
      token: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  },
};

// X/Twitter: OAuth2 user-context, ~2h token + refresh_token (offline.access).
// Refresh <15min out. Needs X_CLIENT_ID/SECRET (basic-auth the token endpoint).
const x: PlatformTokenProvider = {
  platform: 'x',
  refreshWhenWithinMs: 15 * 60 * 1000,
  async check(token): Promise<TokenCheckResult> {
    const res = await withRetry(
      () => fetch('https://api.twitter.com/2/users/me', { headers: { Authorization: `Bearer ${token}` } }),
      { label: 'x_check' },
    );
    if (!res.ok) return { alive: false, reason: `users/me ${res.status}` };
    const j = (await res.json()) as any;
    return { alive: Boolean(j?.data?.id), identity: j?.data?.username };
  },
  async refresh(_token, refreshToken, _meta, ownerId): Promise<RefreshResult> {
    if (!refreshToken) throw new Error('x refresh: no refresh_token');
    // Vault-first (per-user creds pasted in Connections) → env fallback (DAIS default).
    const clientId = await appCred(ownerId, 'x_client_id', env.X_CLIENT_ID);
    const clientSecret = await appCred(ownerId, 'x_client_secret', env.X_CLIENT_SECRET);
    if (!clientId) throw new Error('x refresh: X_CLIENT_ID not set (paste it on the X card or set env)');
    const body = new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    });
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' };
    // Confidential client → HTTP Basic auth on the token endpoint.
    if (clientSecret) {
      headers.Authorization = 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
    }
    const res = await withRetry(
      () => fetch('https://api.twitter.com/2/oauth2/token', { method: 'POST', headers, body }),
      { label: 'x_refresh' },
    );
    const j = (await res.json()) as any;
    if (!res.ok || !j?.access_token) {
      throw new Error(`x refresh failed: ${res.status} ${j?.error ?? ''}`);
    }
    const expiresIn = Number(j.expires_in ?? 0);
    return {
      token: j.access_token,
      refreshToken: j.refresh_token ?? refreshToken, // X rotates the refresh token
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  },
};

export const providers: Record<string, PlatformTokenProvider> = {
  facebook,
  instagram,
  threads,
  linkedin,
  x,
};
