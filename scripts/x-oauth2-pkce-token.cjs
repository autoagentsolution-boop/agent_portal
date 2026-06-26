#!/usr/bin/env node
/**
 * X (Twitter) OAuth2 PKCE helper — mint a USER-CONTEXT access token for posting.
 *
 * App-only Bearer tokens CANNOT create posts; X requires OAuth2 user context.
 * This runs the full 3-legged PKCE flow locally:
 *   1. generate code_verifier + code_challenge (S256)
 *   2. print the authorize URL -> you open it, approve
 *   3. a localhost server catches the ?code=... redirect
 *   4. exchange code -> prints access_token (+ refresh_token if offline.access granted)
 *
 * Prereqs in the X app (developer.x.com -> your app -> User authentication settings):
 *   - App permissions: Read and write
 *   - Type of App: Web App (confidential)  -> sets a Client Secret
 *   - Callback URI: http://localhost:3000/callback   (MUST match exactly)
 *
 * Run:
 *   X_CLIENT_ID=xxx X_CLIENT_SECRET=yyy node scripts/x-oauth2-pkce-token.cjs
 *   (omit X_CLIENT_SECRET if your app is a public/native client)
 */
const http = require('http');
const crypto = require('crypto');

const CLIENT_ID = process.env.X_CLIENT_ID;
const CLIENT_SECRET = process.env.X_CLIENT_SECRET || '';
const REDIRECT_URI = 'http://localhost:3000/callback';
const SCOPES = 'tweet.read tweet.write users.read media.write offline.access';
const AUTHORIZE = 'https://twitter.com/i/oauth2/authorize';
const TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';

if (!CLIENT_ID) {
  console.error('Missing X_CLIENT_ID. Run:\n  X_CLIENT_ID=xxx X_CLIENT_SECRET=yyy node scripts/x-oauth2-pkce-token.cjs');
  process.exit(1);
}

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const codeVerifier = b64url(crypto.randomBytes(32));
const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());
const state = b64url(crypto.randomBytes(16));

const authUrl =
  `${AUTHORIZE}?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

console.log('\n=== STEP 1: open this URL in your browser, sign in as the posting account, click Authorize ===\n');
console.log(authUrl);
console.log('\n(waiting for the redirect on http://localhost:3000/callback ...)\n');

async function exchange(code) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
  });
  const headers = { 'Content-Type': 'application/x-www-form-urlencoded' };
  if (CLIENT_SECRET) {
    headers.Authorization = 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');
  } else {
    body.set('client_id', CLIENT_ID); // public client
  }
  const resp = await fetch(TOKEN_URL, { method: 'POST', headers, body });
  const json = await resp.json();
  return { status: resp.status, json };
}

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://localhost:3000');
  if (u.pathname !== '/callback') { res.writeHead(404); res.end('not found'); return; }
  const code = u.searchParams.get('code');
  const err = u.searchParams.get('error');
  if (err) {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    res.end('Authorization error: ' + err + ' — ' + (u.searchParams.get('error_description') || ''));
    console.error('Authorization denied:', err);
    server.close(); process.exit(1);
  }
  if (u.searchParams.get('state') !== state) {
    res.writeHead(400); res.end('state mismatch'); console.error('state mismatch — abort'); server.close(); process.exit(1);
  }
  const { status, json } = await exchange(code);
  if (json.access_token) {
    res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('OK — token captured. Quay lại terminal. Có thể đóng tab này.');
    const days = json.expires_in ? Math.round(json.expires_in / 3600) + 'h' : '?';
    console.log('\n=== SUCCESS ===');
    console.log('access_token  (' + (json.access_token.length) + ' chars, expires in ' + days + ')');
    console.log('  -> MKT_X_ACCESS_TOKEN=' + json.access_token);
    if (json.refresh_token) {
      console.log('\nrefresh_token (lưu lại để auto-refresh sau — offline.access):');
      console.log('  -> MKT_X_REFRESH_TOKEN=' + json.refresh_token);
    } else {
      console.log('\n(no refresh_token — offline.access scope not granted)');
    }
    console.log('\nscope:', json.scope || '(none)');
  } else {
    res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('Token exchange failed: ' + JSON.stringify(json));
    console.error('\nTOKEN EXCHANGE FAILED (http ' + status + '):', JSON.stringify(json, null, 2));
  }
  server.close();
});
server.listen(3000);
