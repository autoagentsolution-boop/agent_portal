# Connections — owner one-time setup

The Connections screen is **OAuth-first**: each user clicks **Connect → Authorize** with their
own account and enters **zero fields**. That one-click experience only turns on once the
**workspace owner** configures each platform's app **once**. Until then, a platform falls back
to the "paste a token" path (Advanced).

This is a one-time task for the owner/operator — end users (customers) never touch a developer
console.

## What "configured" means per platform

Set these in `MKTAgent/.env` (owner's shared app; all tenants connect their own accounts to it).
When a platform's creds are present, its card shows **Connect** instead of the token form.

| Platform | Env keys | Console |
|----------|----------|---------|
| Facebook / Instagram | `META_APP_ID`, `META_APP_SECRET` | Meta app → add redirect `http://localhost:7100/connect/facebook/callback` and `/connect/instagram/callback` |
| Threads | `THREADS_APP_ID`, `THREADS_APP_SECRET` | Threads app → redirect `http://localhost:7100/connect/threads/callback` |
| LinkedIn | `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET` | LinkedIn app → redirect `http://localhost:7100/connect/linkedin/callback` |
| X (Twitter) | `X_CLIENT_ID`, `X_CLIENT_SECRET` | X app → App permissions **Read and write**, redirect `http://localhost:7100/connect/x/callback` |

Each callback URI must **byte-match** the console registration. Swap `localhost:7100` for the
public host in production (and set `PUBLIC_BASE_URL`).

## Google Drive (media for IG/Threads)

IG and Threads fetch a **public image URL** server-side, so generated images must live somewhere
public. Drive gives each user a public `lh3` URL for images they upload. Reuses the **same Google
OAuth client** as app login (`GOOGLE_CLIENT_ID`/`SECRET`).

Drive **reuses the app's existing Google login redirect** (`GOOGLE_OAUTH_REDIRECT_URI` →
`/auth/google/callback`), so there is **no new redirect URI to register** — the auth callback
detects a Drive consent and stores the token. This removes the `redirect_uri_mismatch` error.

One-time owner steps in Google Cloud console:

1. **Enable the Google Drive API** for the project.
2. OAuth consent screen → **Scopes** → add `.../auth/drive.file`. This scope is **non-sensitive**
   → **no Google verification/review** required.
3. Set the consent screen to **In production** so external customers (not just test users) can
   authorize (or add each tester under **Test users** while in Testing mode). Still no review for
   non-sensitive scopes.

After that, any customer clicks **Connect Google Drive** → authorizes with their Google account →
their generated images publish to IG/Threads. No console for them.

## The paste-a-token fallback

If a platform's app isn't set up, its card shows a minimal token form: the **access token** plus
the one **identity id** the publisher needs to target the right account (Page ID / IG account id /
LinkedIn member id). App/client secrets hide under **Advanced** and are only needed for OAuth
refresh. The identity id is read from the vault at publish time (token-meta → vault → env).

## Notes / current limits

- **Meta page/IG selection after OAuth is not built yet** — a pure OAuth connect stores a user
  token but not which Page / IG business id to post to. For multi-tenant FB/IG today, use the
  token form's Page ID / Account ID field. Page-picker is a follow-up.
- **Video → IG/Threads** is unsupported (Drive's `lh3` returns a thumbnail for video). Images only.
