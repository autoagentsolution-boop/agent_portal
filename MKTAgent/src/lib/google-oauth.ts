// Google OAuth for APP LOGIN ONLY (identity: openid email profile). This is a
// DISTINCT consent from the Drive asset scope (plan T1/§4 ⚠️) — login never
// requests Drive. access_type stays 'online': we never call Google after login,
// so no refresh token is issued (matches the no-refresh JWT decision).
import { OAuth2Client } from 'google-auth-library';
import { env } from '../config/env.ts';

const LOGIN_SCOPES = ['openid', 'email', 'profile'];

export interface GoogleIdentity {
  googleSub: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
}

const client = (): OAuth2Client =>
  new OAuth2Client({
    clientId: env.GOOGLE_CLIENT_ID,
    clientSecret: env.GOOGLE_CLIENT_SECRET,
    redirectUri: env.GOOGLE_OAUTH_REDIRECT_URI,
  });

export const assertGoogleConfigured = (): void => {
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    throw new Error('auth: GOOGLE_CLIENT_ID/SECRET not set');
  }
};

// Build the consent URL. `state` is an opaque CSRF nonce the caller round-trips.
export const buildConsentUrl = (state: string): string => {
  assertGoogleConfigured();
  return client().generateAuthUrl({
    access_type: 'online',
    scope: LOGIN_SCOPES,
    state,
    prompt: 'select_account',
    include_granted_scopes: false,
  });
};

// Exchange the auth code, verify the returned ID token against our client id,
// and project the verified payload into a GoogleIdentity. Throws on any failure
// (invalid code, audience mismatch, unverified email) — the router maps to 401.
export const exchangeCodeForIdentity = async (code: string): Promise<GoogleIdentity> => {
  assertGoogleConfigured();
  const c = client();
  const { tokens } = await c.getToken(code);
  if (!tokens.id_token) throw new Error('auth: no id_token in Google response');

  const ticket = await c.verifyIdToken({
    idToken: tokens.id_token,
    audience: env.GOOGLE_CLIENT_ID,
  });
  const p = ticket.getPayload();
  if (!p?.sub || !p.email) throw new Error('auth: incomplete Google identity');
  if (p.email_verified === false) throw new Error('auth: Google email not verified');

  return {
    googleSub: p.sub,
    email: p.email,
    displayName: p.name ?? null,
    avatarUrl: p.picture ?? null,
  };
};
