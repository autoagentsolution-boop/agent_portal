# Publish-enablement: Drive media + X self-serve + auto-refresh

## Context

MKTAgent generates post images to local disk (`local:<abspath>`) but three platforms can't publish them:

- **IG / Threads** — Meta fetches the image *server-side*; it cannot reach our localhost, and `DriveAssetStore.publicUrl()` throws for `local:` refs. No gen→Drive upload step exists.
- **X** — connect flow + refresh are fully built, but `X_CLIENT_ID/SECRET` are env-only (currently empty), so a user can't self-serve.
- **Auto-refresh** — `runTokenMaintenance()` (refresh-ahead + liveness, per tenant) is fully built and wired in `server.ts:109`, but gated on `ENABLE_TOKEN_CRON`, which defaults false and is unset → **the whole refresh loop is dormant**. No on-access lazy refresh. LinkedIn refresh unimplemented.

**Outcome:** a customer connects Drive + each social account **once**; generated images publish to all five platforms; tokens refresh themselves before expiry with no re-auth.

**Decisions (locked with user):** per-user Drive connect · X creds via vault (UI-native) · full auto-refresh (cron + lazy + LinkedIn).

Key leverage already in the codebase:
- `runTokenMaintenance()` / `providers.ts` — refresh engine, Threads+X refresh done (`src/tokens/service.ts:71`, `src/tokens/providers.ts`).
- X PKCE connect done (`src/social/connect-providers.ts:181`) — stores refresh_token+expiry.
- `AgentCredential` vault table (`ownerId+agentId+key`, encrypted) — reuse for Drive token + X client creds. **No migration.**
- `google.auth.OAuth2` already used for Gmail (`src/leads/notify.ts:40`) — self-refreshing; reuse for Drive. `googleapis` already a dep. `GOOGLE_CLIENT_ID/SECRET` already set.
- `publishTo()` (`src/social/index.ts:24`) — single dispatch seam to materialize `local:`→Drive id for IG/Threads.

---

## Piece 1 — Auto-refresh hardening (smallest, do first)

**1a. Enable the cron.** Add `ENABLE_TOKEN_CRON=true` to `MKTAgent/.env`. Already mounted at `server.ts:109`.

**1b. Lazy on-access refresh.** In `getActiveToken` (`src/tokens/service.ts:15`), after loading the OAuth row and before returning, if the provider has `refresh`+`refreshWhenWithinMs` and `expiresAt` is within window (or unknown), refresh inline, persist via `upsertToken`, return the fresh token. Closes the last-minutes-between-sweeps gap (X = 15 min window). Extract the refresh-or-keep block from `runTokenMaintenance` into a shared `refreshIfDue(rec, provider)` helper in `service.ts` so cron + lazy path share one implementation (DRY). Wrap lazy refresh in try/catch → on failure fall through to returning the existing token (don't break publish on a refresh hiccup; cron + `needs_attention` status will surface it).

**1c. LinkedIn refresh.** Add `refresh()` + `refreshWhenWithinMs` (e.g. 10 day) to the `linkedin` provider in `src/tokens/providers.ts`. LinkedIn uses standard `grant_type=refresh_token` against `https://www.linkedin.com/oauth/v2/accessToken` with `client_id`/`client_secret`. Source these from vault-first then env (see Piece 2 pattern) so it works per-user. Requires the connect scope to include `r_liveness`/offline — verify LinkedIn app has refresh enabled; if the app tier lacks refresh tokens, leave as liveness-only and log (don't fake it).

**Files:** `src/tokens/service.ts`, `src/tokens/providers.ts`, `MKTAgent/.env`.

---

## Piece 2 — X self-serve via vault

Goal: user pastes X **Client ID/Secret** in the Connections form → Connect (existing PKCE) → Authorize → done. No env edit.

**2a. Store creds.** Extend the credential vault allowlist so the publisher agent accepts keys `x_client_id`, `x_client_secret` (the write path is inline in `src/api/agent-router.ts` — locate its allowlist, add the two snake_case keys; per memory the allowlist is snake_case-keyed). Reuse the existing encrypt+upsert.

**2b. Read creds vault-first.** Add a helper in `agent-credential-repo.ts`:
`getPublisherAppCred(ownerId, key): Promise<string|null>` (generic sibling of `getPublisherPlatformToken`, agentId `publisher`).
Then make X read client id/secret **vault-first, env-fallback**:
- Connect: `src/social/connect-providers.ts` X provider `assertConfigured`/`buildAuthUrl`/`exchangeCode` — these are pure today (`env.X_CLIENT_ID`). They need `ownerId`. Thread `ownerId` into the provider methods: change `ConnectProvider` signatures to accept an `ownerId` (or a resolved `{clientId, clientSecret}` creds object built by the router before calling). Router already has `req.userId` at `/start` and `st.ownerId` at `/callback` — resolve creds there and pass down. Least-invasive: add an optional `resolveCreds(ownerId)` step in the router that builds a per-call creds object, and change the X provider methods to take it.
- Refresh: `src/tokens/providers.ts` X `refresh()` reads `process.env.X_CLIENT_ID` (L92). It receives `meta` — but creds aren't in meta. Give the refresh path a vault lookup: `refresh(token, refreshToken, meta, ownerId)`. `runTokenMaintenance` + lazy path already know `ownerId` — thread it into `provider.refresh(...)`. Fall back to env if vault empty.

**2c. `assertConfigured` becomes async/owner-aware.** Since creds are now per-user, `assertConfigured()` must check the vault for that owner. Change it to `assertConfigured(creds)` taking the resolved creds object, throwing if `clientId` missing (keeps router's 500 `connect_not_configured` behavior).

**Files:** `src/api/agent-router.ts` (allowlist), `src/db/repos/agent-credential-repo.ts` (generic cred read), `src/social/connect-providers.ts` (X owner-aware), `src/tokens/providers.ts` (X refresh vault creds), `src/api/connect-router.ts` (resolve+thread creds), `src/social/connect-providers.ts` `ConnectProvider` interface.

**UI:** `web/src/components/connection-credential-form.tsx` — X card gains Client ID + Client Secret fields (alongside the existing access-token field). Persist via the same POST the form already uses.

---

## Piece 3 — Per-user Google Drive connect + gen→upload

The largest piece. Drive is **not** a `SocialPlatform`, so it gets its own connect path (don't force it into the social enum).

**3a. Drive OAuth connect (own route family).** New `src/api/drive-connect-router.ts` mounted at `/connect/drive`:
- `GET /connect/drive/start` (requireAuth) → `google.auth.OAuth2(GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, redirectUri).generateAuthUrl({ access_type:'offline', prompt:'consent', scope:['https://www.googleapis.com/auth/drive.file'] })`, ownerId in signed state JWT (reuse the `issueState`/`readState` pattern — extract to a shared `connect-state.ts` so both routers use it; state currently hardcodes `SocialPlatform`, generalize `platform` to `string`).
- `GET /connect/drive/callback` → `oauth2.getToken(code)` → store `refresh_token` (+access_token/expiry) in the vault under `(ownerId, 'publisher', 'google_drive_refresh_token')`. `drive.file` scope = app only sees files it creates (least privilege).
- Reuse `redirectUri` shape: `${PUBLIC_BASE_URL}/connect/drive/callback` (must be registered in the Google Cloud console OAuth client).

**3b. Drive client + upload.** New `src/assets/drive-client.ts`:
- `getDriveForOwner(ownerId)`: read `google_drive_refresh_token` from vault → `new google.auth.OAuth2(id, secret)` → `setCredentials({ refresh_token })` → `google.drive({version:'v3', auth})`. The client auto-refreshes the access token internally (same as `notify.ts`) → **Drive needs no token-cron entry**.
- `uploadImage(ownerId, filePath): Promise<{fileId}>`: `drive.files.create({ media:{ body: createReadStream(filePath) }, requestBody:{ name } })` then `drive.permissions.create({ fileId, requestBody:{ role:'reader', type:'anyone' } })` so the lh3 CDN URL is publicly fetchable by Meta. Return fileId.
- Idempotency: name gen files by the source hash (`<hash>.png`); optionally `files.list` by name to avoid re-upload on retry. Keep simple first (upload every time) — YAGNI unless retries prove costly.

**3c. Materialize `local:`→Drive at publish.** In `publishTo()` (`src/social/index.ts:24`), for platforms whose adapter consumes `publicUrl` (IG, Threads), before calling `adapter.publish`, map any `local:` asset → upload to the owner's Drive → replace the ref id with the returned fileId. FB/LinkedIn/X keep `local:` (they use `fetchBinary`, works off disk). Guard: if the owner has no Drive connected and the platform needs a public URL, return a clear failed `PublishResult` (`error: 'connect Google Drive to publish images to IG/Threads'`) — mirrors the connection-gate UX. Do the upload **once per post** and reuse the fileId across IG+Threads (hoist above the per-platform loop if the caller fans out; `publishTo` is per-platform, so cache by asset id within the request — check the caller in scheduler/executor and lift the materialization there if cleaner).

**3d. UI — Media storage picker + Drive connect card.** `web/src/components/ConnectionsPanel.tsx` `StorageSection()` currently renders Drive as disabled "Coming soon". Enable it: "Connect Google Drive" button → `GET /connect/drive/start`; show connected/not-connected from a new `/connections` field (extend `connections-router.ts` to report Drive-connected by checking the vault key). `web/src/components/PostBriefForm.tsx` storage `<select>` — enable the `drive` option once connected.

**Files:** `src/api/drive-connect-router.ts` (new), `src/api/connect-state.ts` (new, extracted), `src/assets/drive-client.ts` (new), `src/social/index.ts` (materialize seam), `src/api/connections-router.ts` (report Drive state), `src/server.ts` (mount drive router), `web/src/components/ConnectionsPanel.tsx`, `web/src/components/PostBriefForm.tsx`, `MKTAgent/.env.example` (document `PUBLIC_BASE_URL` needs to be publicly reachable for IG/Threads even with Drive — actually **no**: lh3 URL is public regardless of our host, so Drive path frees IG/Threads from PUBLIC_BASE_URL entirely. Note this.).

---

## Sequencing

1. **Piece 1** (auto-refresh) — self-contained, unblocks the "setup once" guarantee, testable immediately against existing tokens.
2. **Piece 2** (X vault) — depends on nothing in P1/P3; medium.
3. **Piece 3** (Drive) — largest; do last. 3a→3b→3c→3d.

Each piece is independently shippable. Recommend a commit per piece.

## Trade-offs / risks

| Decision | Risk | Mitigation |
|---|---|---|
| Per-user Drive w/ `drive.file` scope | Google OAuth app needs the Drive scope added + (for public) verification for sensitive scopes. `drive.file` is **non-sensitive** (no verification). | Confirm `drive.file` (not `drive`) — no app review needed. |
| `anyone-with-link` permission on each upload | Images are world-readable via lh3 (needed for Meta fetch). | Acceptable — same as current Drive-id model; images are marketing assets meant to be public. Document it. |
| Threading `ownerId` through connect/refresh provider signatures | Touches the `ConnectProvider` interface + all 5 providers. | Additive optional param / resolved-creds object; env fallback keeps existing env-configured flows working. Non-breaking. |
| lh3 CDN serves JPEG thumbnail for **video** fileIds | Video posts to IG/Threads would get a thumbnail, not mp4. | Scope P3 to **images** (matches `nano-banana` gen). For video, hand IG/Threads a Drive direct-download URL — defer; log unsupported. |
| Lazy refresh adds latency to publish | One extra HTTP round-trip when a token is near-expiry. | Only fires inside the refresh window (rare); cron keeps most tokens fresh so lazy path is a safety net, not the hot path. |

## Security

- Drive refresh token + X client secret stored **encrypted** in the vault (AES-256-GCM, `crypto.ts`) — same as all tokens. Never logged (repo helpers already redact).
- `drive.file` scope = app can only touch files it created — cannot read the user's existing Drive. Least privilege.
- Google callback `redirect_uri` must byte-match the console registration; state JWT (HS256, 10 min TTL) prevents CSRF on the callback, same as social connect.
- No secret values printed in logs/tool output (per project rules).

## Verification (end-to-end)

Servers already running: BE `:7100`, web `:5173`, PG `:5433`.

1. **P1 auto-refresh:** set `ENABLE_TOKEN_CRON=true`, restart BE. Run `npx tsx src/tokens/cli.ts maintain` → confirm summary shows `refreshed:true` for a near-expiry token and `alive` liveness. Force lazy path: temporarily set a token's `expiresAt` to now+5min in DB, call an endpoint that hits `getActiveToken`, confirm the row's token/expiry advanced.
2. **P2 X:** in UI Connections → X → paste Client ID/Secret → Save → Connect (OAuth) → Authorize on X → callback stores token+refresh. Verify card turns Connected via `/2/users/me` liveness (free). Do **not** live-post (per `no-burst-social-posts` memory; $0.015/post).
3. **P3 Drive:** UI Connections → Connect Google Drive → Authorize → callback stores refresh token. Generate a post image via orchestration → publish to IG (DRY-RUN first). Confirm: image uploaded to Drive (fileId in logs), `publicUrl` returns lh3 URL, DRY result shows the reachable URL. Flip one real IG post only if user explicitly approves.
4. `npm run typecheck` in MKTAgent + `npm run build` in web must be clean.
5. Run existing verify scripts (`verify-api`, adapter DRY) against the running BE — no regressions.

## Open questions

1. **Google Cloud console:** does the existing OAuth client (GOOGLE_CLIENT_ID) have an authorized redirect URI we can add `/connect/drive/callback` to, and can we add the `drive.file` scope? (User action, external.) For localhost dev, `PUBLIC_BASE_URL` for the Drive callback must match a registered redirect — confirm the dev redirect (`http://localhost:7100/connect/drive/callback`) is registered.
2. **Materialization locality:** confirm whether the scheduler/executor fans out one post to N platforms in a loop (→ lift Drive upload above the loop to upload once) or calls `publishTo` per platform independently (→ cache fileId per asset within the request). Will confirm by reading the caller before implementing 3c.
3. **LinkedIn refresh availability:** depends on the LinkedIn app tier — if refresh tokens aren't issued, 3.1c stays liveness-only. Verify against a real connect.
