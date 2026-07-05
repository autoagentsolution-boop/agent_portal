# Publishing Media Constraints (per-platform)

Status: **RESOLVED 2026-07-05** (code) — see "Resolution" below. Original analysis
(recorded 2026-07-02) kept for context.

---

## Resolution (implemented 2026-07-05)

Both deferred fixes shipped as three pieces. Code is live; each needs a one-time
**external console** step (below) before it publishes for real.

### Piece 1 — Token auto-refresh (fixes "X token expires in ~2h")
- `ENABLE_TOKEN_CRON=true` (set in `MKTAgent/.env`) — the per-tenant refresh-ahead +
  liveness sweep (`runTokenMaintenance`) now runs hourly.
- **Lazy on-access refresh** in `getActiveToken` (`src/tokens/service.ts`): a token
  inside its refresh window is refreshed inline at publish time — closes the gap between
  sweeps (X's window is only 15 min). Shared `refreshIfDue()` helper = one implementation
  for cron + lazy. Best-effort: a refresh hiccup falls through to the existing token.
- Refresh and liveness are now **independent** in the sweep — a refresh failure (e.g.
  LinkedIn tier issues no refresh_token) no longer flags an otherwise-live token.
- LinkedIn `refresh()` added (standard `grant_type=refresh_token`), creds vault-first→env.

### Piece 2 — X self-serve via vault (fixes "X_CLIENT_ID env-only")
- X connect + refresh read `x_client_id` / `x_client_secret` **vault-first, env-fallback**.
  A user pastes their X app Client ID/Secret on the X card → **Connect (OAuth)** → Authorize
  → a user-context token + refresh_token land in the store, and auto-refresh keeps them live.
- `ConnectProvider` methods are now owner-aware (`ownerId` threaded through); only X uses it
  (Meta/Threads/LinkedIn keep DAIS's shared env app).

### Piece 3 — Per-user Google Drive → lh3 public URL (fixes IG/Threads "no public URL")
- **Connect once:** Connections → Storage → **Connect Google Drive** (`/connect/drive/start`,
  scope `drive.file` — non-sensitive, no Google app review). Refresh token stored encrypted in
  the vault; `google.auth.OAuth2` self-refreshes → no token-cron entry needed.
- **At publish:** `processPost` (`src/scheduler/tick.ts`) uploads any `local:` **image** to the
  owner's Drive **once per post** (`materializeForPublicUrl`), makes it anyone-with-link
  readable, and hands IG/Threads the resulting lh3 URL. FB/LinkedIn/X keep `local:` (bytes off
  disk). The lh3 URL is public regardless of our host → **works from localhost, no tunnel.**
- Partial-success preserved: no Drive / upload failure → IG/Threads fail with a clear message
  while FB/X still publish. **Video → IG/Threads stays unsupported** (lh3 serves a thumbnail).

### One-time external console setup (USER action)

**Google Cloud console** (same OAuth client as Google login, `GOOGLE_CLIENT_ID`):
1. APIs & Services → **Enable the Google Drive API** for the project.
2. Credentials → the OAuth 2.0 Client → **Authorized redirect URIs** → add
   `http://localhost:7100/connect/drive/callback` (and the prod URL when deployed).
3. OAuth consent screen → **Scopes** → add `.../auth/drive.file` (non-sensitive; if the app is
   in Testing, add your Google account under **Test users**).

**X Developer Portal** (per user who wants X):
1. App → User authentication settings → App permissions **Read and write** → Type **Web App** →
   Callback URI `http://localhost:7100/connect/x/callback` → Save.
2. Copy the **OAuth 2.0** Client ID + Client Secret → paste on the X card in Connections →
   Save → **Connect** → Authorize. (The old Postman manual-token path still works but has no
   refresh — the Connect flow is the durable one.)

---

## Original analysis (2026-07-02) — known limitation, local-only environment

How each adapter consumes post media splits the platforms into two camps, and that
split is the source of the IG/Threads/X failures seen in the post playground.

## The two media-delivery models

| Model | Platforms | How media reaches the platform | Works with `local:` asset? |
|-------|-----------|--------------------------------|-----------------------------|
| **Server-side fetch** | Instagram, Threads | We hand Meta a **public `image_url`**; Meta's servers fetch it | ❌ No — Meta cannot reach our disk / localhost |
| **Client-side binary upload** | Facebook, LinkedIn, X | We read the raw bytes (`fetchBinary`) and POST multipart | ✅ Yes — bytes read straight off disk |

Source: `MKTAgent/src/assets/store.ts` (`DriveAssetStore.publicUrl` vs `fetchBinary`),
`instagram.ts:58`, `threads.ts:55` (both call `publicUrl`), `facebook.ts`/`linkedin.ts`/`x.ts` (call `fetchBinary`).

Orchestration-generated images land on disk as `local:<abspath>` (`agent-runners.ts:275`,
`imagegen/nano-banana.ts` → `output/images/<hash>.png`), served read-only at
`/media/images/<hash>.png` (`server.ts:47`).

## Issue 1 — Instagram + Threads fail locally

**Error:** `local asset has no public URL — use a Drive id for IG/Threads, or fetchBinary for FB/LinkedIn/X`

**Root cause:** `publicUrl()` deliberately throws for `local:` refs rather than emit an
unreachable URL. IG/Threads need Meta to fetch the image server-side, but:
- `PUBLIC_BASE_URL` defaults to `http://localhost:7100` — Meta cannot reach localhost.
- There is **no gen-image → upload-to-user-Drive step**, so we have no Drive fileId to
  hand IG/Threads either. The `DriveAssetStore` reads existing Drive ids; nothing writes
  generated images up to the user's Drive.

**Net:** IG/Threads publishing of orchestration-generated images is **blocked in the
current local-only setup**. Not a code bug — a missing piece of infrastructure.

**Fix paths (deferred, not implemented):**
1. **Public host** — deploy behind a public domain (or ngrok tunnel for demo), set
   `PUBLIC_BASE_URL` to it, and wire `publicUrl()` for `local:` refs to
   `${PUBLIC_BASE_URL}/media/images/${basename(path)}`. Route already exists; smallest change.
2. **Gen → Drive upload** — after image gen, upload the local file to the user's Google
   Drive, store the fileId as the asset ref, let `DriveAssetStore.publicUrl` serve the
   lh3 CDN URL. Requires user Google OAuth + a Drive-write path that does not exist yet.
   ⚠️ lh3 returns a JPEG *thumbnail* for video fileIds — images only.

## Issue 2 — X (Twitter) 403 on media upload

**Error:** `X: media upload failed: 403 {"title":"Unsupported Authentication","detail":"Authenticating with OAuth 2.0 Application-Only is forbidden for this endpoint"}`

**Root cause:** `POST /2/media/upload` requires a **user-context** OAuth2 token; the token
in the store is an **application-only bearer**. Different bug from Issue 1 — X uses binary
upload (`fetchBinary`), so the media path itself is fine; the auth is wrong.

**Why manual is the only zero-config path:** X's `/2/media/upload` requires a **user-context**
token, and X only mints those via the OAuth2 PKCE flow — the Developer Portal gives you an
API Key/Secret (v1.1), a **Bearer Token (app-only → the 403)**, and an **OAuth 2.0
Client ID/Secret** (raw material for PKCE, not a usable token). There is no "copy a ready
token from the portal" option like FB's Page token.

**Interim (manual token → Connections → "Enter token" → Access token field):**
1. X Developer Portal → App → User authentication settings → App permissions = **Read and
   write** (⚠️ else 403 even with the right token type) → Type = Web App → Callback URI
   `https://oauth.pstmn.io/v1/callback` → Save. Copy the **OAuth 2.0** Client ID + Secret.
2. Postman → any request → Authorization → OAuth 2.0 → Grant `Authorization Code (With PKCE)`,
   Auth URL `https://twitter.com/i/oauth2/authorize`, Token URL
   `https://api.twitter.com/2/oauth2/token`, Callback `https://oauth.pstmn.io/v1/callback`,
   Scope `tweet.read tweet.write media.write users.read offline.access` (⚠️ `media.write` is
   the scope that gates `/2/media/upload`), Client Authentication = Send as Basic Auth header.
3. Get New Token → Authorize on X → copy `access_token`.
4. UI → X card → **Enter token** → paste into **Access token** (`x_access_token`, resolved by
   the vault fallback `tokens/service.ts:25`) → Save & connect. Leave Client ID/Secret blank.
5. Verify via the free `/2/users/me` liveness (card turns Connected). Don't test with a real
   post ($0.015/post).

⚠️ Manual token lives ~2h and carries **no refresh** (the Enter-token form stores no
`refresh_token`). On expiry, repeat steps 3-4. Auto-refresh needs the OAuth `Connect` button,
which currently reads `X_CLIENT_ID/SECRET` from env — deferred (see below).

## Deferred implementation (do together, later)

Both fixes were consciously deferred to ship the local demo. Do them in one pass:

1. **Gen media → Google Drive → post (fixes IG/Threads).** After image/video gen, upload the
   local file to the user's Google Drive, store the returned fileId as the asset ref so
   `DriveAssetStore.publicUrl` serves a Meta-reachable lh3 URL. Needs user Google OAuth with
   Drive-write scope + a real upload step (none exists — `DriveAssetStore` only *reads* existing
   ids). ⚠️ lh3 serves a JPEG thumbnail for video fileIds — for video, hand IG/Threads a Drive
   direct/download URL, not lh3. This unblocks IG + Threads and gives FB/LinkedIn/X a durable
   asset store beyond `local:`.
2. **X OAuth via vault (fully UI-native connect).** Let the X OAuth flow read
   `x_client_id`/`x_client_secret` from the vault (same pattern as `getActiveToken`'s vault
   fallback) instead of env only. Then: Enter token form → paste Client ID/Secret → Connect
   (OAuth) → Authorize → done, no env touch, with auto-refresh. ~30-40 lines in
   `connect-providers.ts` (X provider) + thread `ownerId` through connect-router. No migration.

## Demo-safe posture (Fri 2026-07-03)

- **FB is the only safe live publish** for orchestration-generated local images —
  binary upload, no public-URL requirement, no per-post charge.
- LinkedIn also works mechanically (binary upload) if a live token is connected.
- **IG / Threads / X**: leave in Safe mode / DRY-RUN until either a public host or a
  Drive-upload step lands. Live attempts will fail with the errors above.
