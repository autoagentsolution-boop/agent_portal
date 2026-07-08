# P3 — Media storage via Google Drive (unblock multi-platform publish)

**Priority:** P1 · **Status:** planned · Enabled by decision 4 (keep Google auth → reuse Drive, no S3).

## Key insight
Today only Facebook publishes media live; IG/Threads/LinkedIn image publish FAILS because the media is a
`local:<path>` file with no PUBLIC URL Meta/LinkedIn can fetch (memory: `project_publishing_media_
constraints`). The user's decision to keep Google login specifically to leverage **Google Drive** solves
this: upload the generated asset to the user's Drive, make it link-shareable, and pass that public URL to
the platform publish path — no S3/CDN to build. The Drive OAuth + reuse already exist
(`google_drive_refresh_token` cred is present; Drive login callback reused per `project_connections_
simplify`).

## Files
- `src/assets/store.ts` (`publicUrl`, `fetchBinary` — the seam adapters call; Threads uses `publicUrl`),
  `src/social/{instagram,threads,linkedin}.ts` (consume a public image_url), the Drive client
  (existing refresh-token cred + `PUBLIC_BASE_URL` today), `agent-credential-repo` (drive cred).

## Steps
1. On media generation (infographic/storyboard frames), upload the asset to the owner's Drive folder and
   record a shareable `https://drive.google.com/uc?...`/`lh3` public URL alongside the local ref.
2. `assetStore.publicUrl(ref)` returns the Drive public URL when present (falls back to local for FB,
   which uploads binary directly).
3. IG/Threads container create + LinkedIn use the Drive URL → real multi-platform image publish.
4. Respect per-user Drive; clean up / TTL old assets to bound storage.

## FINDING 2026-07-08 — P3 CODE ALREADY COMPLETE (built 2026-07-05, verified this session)
Investigated: the whole Drive→public-URL path is already wired end-to-end and the runtime prereqs
are met. Nothing needed re-wiring.
- `processPost` (scheduler/tick.ts) runs `materializeForPublicUrl` (local: image → owner's Drive
  fileId) gated on `hasDriveConnected`, for platforms in `NEEDS_PUBLIC_URL={instagram,threads}`.
- ALL THREE publish paths reach it: scheduler cron (`runSchedulerTick`), DAG publisher node
  (agent-runners → `publishPostNow`), manual "Publish now" (posts-router → `publishPostNow`) — all
  call `processPost`. So no path bypasses Drive.
- `assetStore.publicUrl` → lh3 for a Drive id, throws for `local:` (loud). FB/LinkedIn/X use
  `fetchBinary` (binary off disk) → LinkedIn never needed Drive (plan's "LinkedIn fails" was a
  separate/untested concern, not the public-URL issue).
- Prereqs met for the test account: creds present = google_drive_refresh_token, instagram_access_token
  + instagram_business_account_id, threads_access_token (+ fb/linkedin/x).
- **VERIFIED the exact broken→fixed link (no social post):** uploaded a real 1.39 MB PNG via
  `uploadImageToDrive` → `publicUrl` lh3 → public `fetch` = HTTP 200, image/png, 1391343 bytes. Meta
  can fetch it. The `local asset has no public URL` blocker is functionally resolved.

## Todo
- [x] Drive upload on media gen/publish (owner folder) + public URL on the asset ref — `materializeForPublicUrl`
- [x] `assetStore.publicUrl` prefers Drive URL; FB stays binary — DriveAssetStore
- [x] IG/Threads publish consume the public URL (image) — instagram.ts/threads.ts use publicUrl (LinkedIn=fetchBinary, N/A)
- [~] Live-verify — critical Drive→public-URL link VERIFIED (200/image/png). Actual IG/Threads feed post
  = outward-facing + burst-risk ([[feedback_no_burst_social_posts]]) → USER-triggered, one controlled post/platform.
- [ ] TTL/cleanup for Drive assets — NOT built (optional; YAGNI until storage bloats). Only real remaining code item.

## Status: DONE (code + critical-link verification). Only optional TTL cleanup + a user-triggered live social post remain.

## Success criteria
- An image post publishes for real to IG/Threads/LinkedIn (not just FB) using a Drive public URL.
- No S3/CDN dependency introduced.

## Risk
- Drive share-link scope + quota; Meta ingest latency (Threads already waits ~30s). Test one controlled
  live publish per platform (no bursts — [[feedback_no_burst_social_posts]]).
