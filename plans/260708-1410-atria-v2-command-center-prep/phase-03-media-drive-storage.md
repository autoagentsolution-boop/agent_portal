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

## Todo
- [ ] Drive upload on media gen (owner folder) + store public URL on the asset ref
- [ ] `assetStore.publicUrl` prefers Drive URL; FB stays binary
- [ ] IG/Threads/LinkedIn publish consume the public URL (image)
- [ ] Live-verify IG/Threads image publish (currently blocked); LinkedIn image
- [ ] TTL/cleanup for Drive assets

## Success criteria
- An image post publishes for real to IG/Threads/LinkedIn (not just FB) using a Drive public URL.
- No S3/CDN dependency introduced.

## Risk
- Drive share-link scope + quota; Meta ingest latency (Threads already waits ~30s). Test one controlled
  live publish per platform (no bursts — [[feedback_no_burst_social_posts]]).
