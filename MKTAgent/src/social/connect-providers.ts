// Per-user social connect providers (T4). Each platform knows how to (a) build its
// OAuth consent URL and (b) exchange the returned code for a storable token. This
// is the REAL-USER onboarding path — distinct from the DAIS env-seed. Mirrors the
// shape of tokens/providers.ts (liveness/refresh) so the two stay symmetric.
//
// ⚠️ External-constraint gate (plan): the flows below are correct, but real posting
// scopes (pages_manage_posts, w_member_social, tweet.write, …) require platform
// app-review + business verification. Each provider fail-fasts until its app creds
// are set — same gate as Google login. Test now with your OWN dev-mode app.
import { env } from '../config/env.ts';
import { withRetry } from '../lib/retry.ts';
import type { SocialPlatform } from '../../prisma/generated/prisma/client.ts';

export interface ConnectExchange {
  token: string;
  refreshToken?: string | null;
  expiresAt?: Date | null;
  meta?: Record<string, unknown> | null;
}

export interface ConnectProvider {
  platform: SocialPlatform;
  // PKCE (X) needs a per-attempt code_verifier round-tripped through signed state.
  usesPkce?: boolean;
  // Throws if this platform's OAuth client isn't configured (→ router maps to 500).
  assertConfigured(): void;
  buildAuthUrl(redirectUri: string, state: string, codeChallenge?: string): string;
  exchangeCode(
    code: string,
    redirectUri: string,
    codeVerifier?: string,
  ): Promise<ConnectExchange>;
}

const need = (v: string, name: string): string => {
  if (!v) throw new Error(`connect: ${name} not set`);
  return v;
};

const postForm = async (url: string, body: URLSearchParams, headers?: Record<string, string>): Promise<any> => {
  const res = await withRetry(
    () =>
      fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', ...headers },
        body,
      }),
    { label: 'connect_exchange' },
  );
  return res.json();
};

const G = env.GRAPH_VERSION;

// ── Meta: Facebook Pages + Instagram (shared Meta app, graph.facebook.com) ──────
// User-token exchange → long-lived. Page/IG selection (which page, IG business id)
// is a follow-up step the UI drives; we store the long-lived user token + note.
const metaScopes = 'pages_show_list,pages_manage_posts,pages_read_engagement,instagram_basic,instagram_content_publish,business_management';

const meta = (platform: SocialPlatform): ConnectProvider => ({
  platform,
  assertConfigured() {
    need(env.META_APP_ID, 'META_APP_ID');
    need(env.META_APP_SECRET, 'META_APP_SECRET');
  },
  buildAuthUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: env.META_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: metaScopes,
      response_type: 'code',
    });
    return `https://www.facebook.com/${G}/dialog/oauth?${q.toString()}`;
  },
  async exchangeCode(code, redirectUri) {
    // 1) code → short-lived user token
    const shortQ = new URLSearchParams({
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      redirect_uri: redirectUri,
      code,
    });
    const short = await postForm(`https://graph.facebook.com/${G}/oauth/access_token`, shortQ);
    if (short?.error || !short?.access_token) {
      throw new Error(`meta code exchange failed: ${short?.error?.message ?? 'no token'}`);
    }
    // 2) short → long-lived (~60d)
    const longQ = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: env.META_APP_ID,
      client_secret: env.META_APP_SECRET,
      fb_exchange_token: short.access_token,
    });
    const long = await postForm(`https://graph.facebook.com/${G}/oauth/access_token`, longQ);
    const token = long?.access_token ?? short.access_token;
    const expiresIn = Number(long?.expires_in ?? 0);
    return {
      token,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
      meta: { note: 'user token — page/IG selection is a follow-up step' },
    };
  },
});

// ── Threads (graph.threads.net, separate app) ───────────────────────────────────
const threads: ConnectProvider = {
  platform: 'threads',
  assertConfigured() {
    need(env.THREADS_APP_ID, 'THREADS_APP_ID');
    need(env.THREADS_APP_SECRET, 'THREADS_APP_SECRET');
  },
  buildAuthUrl(redirectUri, state) {
    const q = new URLSearchParams({
      client_id: env.THREADS_APP_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'threads_basic,threads_content_publish',
      response_type: 'code',
    });
    return `https://threads.net/oauth/authorize?${q.toString()}`;
  },
  async exchangeCode(code, redirectUri) {
    const q = new URLSearchParams({
      client_id: env.THREADS_APP_ID,
      client_secret: env.THREADS_APP_SECRET,
      grant_type: 'authorization_code',
      redirect_uri: redirectUri,
      code,
    });
    const j = await postForm('https://graph.threads.net/oauth/access_token', q);
    if (j?.error || !j?.access_token) {
      throw new Error(`threads code exchange failed: ${j?.error_message ?? j?.error ?? 'no token'}`);
    }
    return {
      token: j.access_token,
      meta: j?.user_id ? { userId: String(j.user_id) } : null,
    };
  },
};

// ── LinkedIn (OAuth 2.0 authorization code) ─────────────────────────────────────
const linkedin: ConnectProvider = {
  platform: 'linkedin',
  assertConfigured() {
    need(env.LINKEDIN_CLIENT_ID, 'LINKEDIN_CLIENT_ID');
    need(env.LINKEDIN_CLIENT_SECRET, 'LINKEDIN_CLIENT_SECRET');
  },
  buildAuthUrl(redirectUri, state) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.LINKEDIN_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'w_member_social openid profile',
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${q.toString()}`;
  },
  async exchangeCode(code, redirectUri) {
    const q = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.LINKEDIN_CLIENT_ID,
      client_secret: env.LINKEDIN_CLIENT_SECRET,
    });
    const j = await postForm('https://www.linkedin.com/oauth/v2/accessToken', q);
    if (j?.error || !j?.access_token) {
      throw new Error(`linkedin code exchange failed: ${j?.error_description ?? j?.error ?? 'no token'}`);
    }
    const expiresIn = Number(j.expires_in ?? 0);
    return {
      token: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  },
};

// ── X / Twitter (OAuth2 user-context, PKCE) ─────────────────────────────────────
const x: ConnectProvider = {
  platform: 'x',
  usesPkce: true,
  assertConfigured() {
    need(env.X_CLIENT_ID, 'X_CLIENT_ID');
  },
  buildAuthUrl(redirectUri, state, codeChallenge) {
    const q = new URLSearchParams({
      response_type: 'code',
      client_id: env.X_CLIENT_ID,
      redirect_uri: redirectUri,
      state,
      scope: 'tweet.read tweet.write media.write users.read offline.access',
      code_challenge: codeChallenge ?? '',
      code_challenge_method: 'S256',
    });
    return `https://twitter.com/i/oauth2/authorize?${q.toString()}`;
  },
  async exchangeCode(code, redirectUri, codeVerifier) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: env.X_CLIENT_ID,
      code_verifier: codeVerifier ?? '',
    });
    const headers: Record<string, string> = {};
    // Confidential client → HTTP Basic on the token endpoint.
    if (env.X_CLIENT_SECRET) {
      headers.Authorization = 'Basic ' + Buffer.from(`${env.X_CLIENT_ID}:${env.X_CLIENT_SECRET}`).toString('base64');
    }
    const j = await postForm('https://api.twitter.com/2/oauth2/token', body, headers);
    if (j?.error || !j?.access_token) {
      throw new Error(`x code exchange failed: ${j?.error_description ?? j?.error ?? 'no token'}`);
    }
    const expiresIn = Number(j.expires_in ?? 0);
    return {
      token: j.access_token,
      refreshToken: j.refresh_token ?? null,
      expiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000) : null,
    };
  },
};

export const connectProviders: Record<SocialPlatform, ConnectProvider> = {
  facebook: meta('facebook'),
  instagram: meta('instagram'),
  threads,
  linkedin,
  x,
};
