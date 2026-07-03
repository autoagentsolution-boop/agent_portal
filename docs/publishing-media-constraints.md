# Publishing Media Constraints (per-platform)

Status: **known limitation, local-only environment** — recorded 2026-07-02.

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
