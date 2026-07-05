# Project Changelog

Significant changes to the MKTAgent backend (the plain-TS marketing pipeline on
`pivot/video-content-farm`). Newest first. Commit hashes are on that branch.

## 2026-07-05

### Video polish — Veo audio off, consistent frames, voiceover in user's language
Follow-up fixes after the first storyboard/video pass:
- **Veo RAI audio filter fixed** — live Veo returned `raiMediaFilteredCount` ("issue with the
  audio for your prompt"). Veo's native audio is uncontrollable AI-invented sound, so we set
  `generateAudio: false` and surface the RAI reason instead of a cryptic no-video. Voiceover
  comes from a dedicated TTS step, not Veo.
- **Storyboard visual consistency** — the first successful frame anchors the rest via
  nano-banana `edit` (reference conditioning); the prompt enforces a shared style+subject anchor
  phrase, so frames cohere instead of drifting per independent gen. (imageFn seam widened to
  ImageRequest.)
- **Voiceover** — new `src/video/tts.ts` (Gemini TTS `gemini-2.5-flash-preview-tts`, reuses
  `GEMINI_API_KEY`, multilingual, PCM→WAV, cached); `stitch.muxAudio` mixes it onto the stitched
  video with `apad + -shortest` so the output is ALWAYS the video length (never truncated).
  `ttsFn` seam stubbed in the 4 verify scripts.
- **Voiceover language follows the USER, not the product** — captions (= narration) were drifting
  to the product's language (a VN-named product → Vietnamese voice). The storyboard now resolves
  the effective language = campaign language → user's `defaultLanguage` → English, and forces
  captions into it. Verified: EN campaign + "Bò Kho" product → English captions.

Note: rerun-infographic "video doesn't run" was traced to the video node FAILING on the Veo audio
error (the DAG is correct — video is downstream of storyboard, not infographic). Veo still not
live-tested end-to-end (paid, slow); the audio fix should clear the failure.

### Storyboard = real images · Video = Veo i2v (rendered mp4)
The `storyboard` and `video` agents produce real **media**, reviewable in the UI (corrects an
earlier text-only version). `runStoryboard`: LLM plans 3-6 frames → generates an image per frame
(nano-banana), tolerant of the ~1/3 flaky no-image responses (skips a failed frame). `runVideo`:
new `src/video/veo.ts` (Veo i2v `predictLongRunning`, veo-3.1-lite, poll + cache) animates each
frame → `src/video/stitch.ts` ffmpeg-concats the clips → one mp4 → set as the Post hero. ffmpeg
added to the Docker image; `/media/videos` served static; `videoFn` seam stubbed in the 4 verify
scripts (no Veo spend in DRY). Review UI renders a storyboard gallery + a `<video>` player. Live:
storyboard = 4 real VN-captioned frames ($0.16); Veo left for a paid live smoke test. (Only
`content_search` remains a stub.)

### Drive uploads organized by campaign folder + ordered filenames
Generated images now upload into `MKTAgent/<campaign>/` (find-or-create folder, cached) instead
of the Drive root, with filenames stamped `NN-<campaign-slug>-<hash>.png`. Publish/upload order is
the `assets[]` array index — never generation-completion time — so multi-image posts stay in the
intended sequence, and the index prefix makes them sort correctly in the Drive UI too. `slugify`
strips Vietnamese diacritics.

### Connection status honesty + Drive redirect fix
- **Status was lying:** a pasted access token showed "connected" with **zero verification** (any
  saved vault key → connected). Now a save runs a real **liveness check** (`verifyAndRecordFormToken`)
  and records the true status as a token row; a legacy vault token with no status row → **needs
  attention**, not a false "connected". The form surfaces the result ("connected" vs "saved, but the
  token could not be verified: …"). Confirmed: a garbage X token → `alive:false, users/me 403`.
- **Drive `redirect_uri_mismatch` fixed** by **reusing the already-registered login redirect**
  (`GOOGLE_OAUTH_REDIRECT_URI`). The Drive consent uses the same callback; `/auth/google/callback`
  detects a drive-scoped state and stores the refresh token. **No new redirect URI to register** —
  owner only enables the Drive API + adds `drive.file` scope. UI hint + owner doc updated.

### Connections simplified — OAuth-first, non-tech friendly
Reworked the Connections screen for non-technical multi-tenant users: lead with one-click
**Connect**, hide field bloat, and make the paste-token fallback actually publish.

- **Adaptive card** — `connections-router` now returns `oauthConfigured` per platform (new
  `isOAuthConfigured` helper). UI leads with **Connect** when the owner has set up that
  platform's app; otherwise shows a one-line owner hint + the paste-token fallback. Contract +
  web types regenerated.
- **Minimal fields** — `publisher-credential-fields` split into `required` (access token + the ONE
  identity id) and `advanced` (app/client secrets, collapsed). Form renders required first with
  an "Advanced ▸" disclosure.
- **Fixed latent bug** — FB/IG/LinkedIn adapters now resolve their identity id token-meta →
  **vault** (`getPublisherAppCred`) → env, so a pasted token + id actually publishes (previously
  the id fields were saved but never read). LinkedIn accepts a bare member id or a full urn.
- **Drive** — code was already correct; the "not working" was the one-time Google console setup
  (register `/connect/drive/callback` + enable Drive API + `drive.file` scope). Added an in-UI
  owner-setup hint (end users have ZERO console friction — inherent to OAuth) and hardened
  `PUBLIC_BASE_URL` (blank env → dev default, was yielding a relative redirect).
- Owner one-time setup documented in `docs/connections-owner-setup.md`.

Deferred (flagged): Meta page/IG selection after OAuth (multi-tenant FB/IG uses the token-form id
for now); video→IG/Threads. Plan: `plans/260705-1159-connections-simplify/plan.md`.

### Publish-enablement IMPLEMENTED — Drive media + X self-serve + auto-refresh
Built all three pieces planned 2026-07-03. Verified against the rebuilt container
(typecheck + web build clean; verify-vault / verify-api / verify-runtime green; token cron
starts; `token maintain` clean). Live e2e pending user's external console setup.

- **Piece 1 — auto-refresh.** `ENABLE_TOKEN_CRON=true`. Extracted shared `refreshIfDue()`
  (`src/tokens/service.ts`) used by both the cron sweep and a new **lazy on-access refresh** in
  `getActiveToken` (closes the sub-sweep gap; X window = 15 min; best-effort with fall-through).
  Sweep now separates refresh from liveness — a refresh failure no longer flags a live token.
  LinkedIn `refresh()` added (creds vault-first→env).
- **Piece 2 — X self-serve.** `ConnectProvider` methods owner-aware (`ownerId` threaded through
  connect-router → provider); X connect + refresh read `x_client_id`/`x_client_secret`
  vault-first→env. Meta/Threads/LinkedIn unchanged (shared env app). UI fields already present.
- **Piece 3 — Google Drive.** New `src/assets/drive-client.ts` (upload + `anyone:reader` +
  OAuth2 self-refresh), `src/assets/materialize.ts` (`local:`→Drive fileId, IG/Threads only,
  images only), `src/api/drive-connect-router.ts` (`/connect/drive/*`, `drive.file` scope),
  mounted before the social `/connect` router. `processPost` materializes once per post before
  fan-out; partial-success preserved. New `GET /connections/storage` + Storage UI card enabled.
  Reusable `savePublisherCredential()` write helper. Allowlist gains `google_drive_refresh_token`.

No migration (reuses `AgentCredential` vault). External setup (Drive API + redirect + scope; X
callback + Client ID/Secret) documented in `docs/publishing-media-constraints.md` "Resolution".

## 2026-07-03

### Publish-enablement plan: Drive media + X self-serve + auto-refresh (PLANNED, not built)
Planned the work to make IG/Threads/X/LinkedIn publishing work end-to-end and give a
setup-once auto-refresh guarantee. Plan at `plans/260703-1048-publish-drive-x-refresh/plan.md`.
Codebase survey found most of the plumbing already exists — the plan is mostly wiring + enabling,
not new subsystems:

- **Auto-refresh (Piece 1)** — `runTokenMaintenance()` (refresh-ahead + liveness per tenant) and
  the token cron are already built and wired at `server.ts:109`, but dormant: `ENABLE_TOKEN_CRON`
  defaults false and is unset. Plan: enable the flag, add lazy on-access refresh in
  `getActiveToken` (shared `refreshIfDue()` helper), implement LinkedIn refresh.
- **X self-serve (Piece 2)** — the OAuth2 PKCE connect flow is fully built and stores the
  refresh_token; the only blocker is `X_CLIENT_ID/SECRET` being env-only (and empty). Plan: store
  `x_client_id`/`x_client_secret` in the `AgentCredential` vault, read vault-first→env-fallback,
  thread `ownerId` through the connect + refresh providers. UI gains Client ID/Secret fields.
- **Google Drive (Piece 3, largest)** — per-user Drive connect (`/connect/drive`, non-sensitive
  `drive.file` scope → no app review), new `drive-client.ts` (`google.auth.OAuth2` self-refreshes
  like `leads/notify.ts` → no token-cron entry) uploads gen'd images and sets `anyone:reader`; the
  `publishTo()` seam materializes `local:`→Drive fileId for IG/Threads only (FB/LI/X keep binary
  upload off disk). The public lh3 CDN URL is reachable by Meta regardless of our host — the Drive
  path frees IG/Threads from the `PUBLIC_BASE_URL`/public-host requirement entirely.

Reuses the encrypted `AgentCredential` vault (no migration) and `googleapis` (already a dep;
`GOOGLE_CLIENT_ID/SECRET` already set for Gmail). Locked decisions: per-user Drive · X via vault ·
full auto-refresh. No implementation this session — planning + context capture only.

## 2026-07-02

### Publishing media constraints documented (no code change)
Real post test surfaced two independent publish failures, both recorded in
`docs/publishing-media-constraints.md`:
- **IG + Threads** (`local asset has no public URL`) — these platforms fetch the image
  server-side from a public `image_url`; orchestration images live on disk as `local:<path>`
  and `PUBLIC_BASE_URL` defaults to localhost, so Meta can't reach them. No gen-image →
  upload-to-user-Drive step exists yet, so there's also no Drive fileId to hand them. **Blocked
  in local-only setup** — needs a public host or a Drive-upload step (both deferred).
- **X** (`403 Unsupported Authentication / OAuth 2.0 Application-Only is forbidden`) — the stored
  `x` token is app-only; `/2/media/upload` requires a user-context token. Reconnect via the
  PKCE flow (`/connect/x/start`); scopes already include `media.write`.
- **Demo-safe:** FB is the only fully-safe live publish for local images (binary upload, no
  public URL, no per-post charge). IG/Threads/X stay DRY-RUN until infra lands.

### Post-execution playground UX (4 fixes — NOT committed yet)
Four issues from the post-execution real test.

- **Rerun no longer dead-ends** — re-running a step (e.g. concept_writer) now parks the run at
  `planned` (resumable) instead of `needs_approval`; the Execute button reappears as
  **"Continue"** and resumes from the stale downstream, halting at the publisher gate. Previously
  the run stuck with neither an approve nor an execute button.
- **Inline copy edit + Refine** — `POST /posts/:id/edit-copy` hand-edits the generated copy with
  no LLM/token spend (review|ready → review); the concept artifact gets **Edit copy** and
  **Refine with AI** buttons.
- **Connection redirect** — the connect gate now links to the full Connections page
  (`onOpenConnections` threaded App → PostWorkflowView; "Manage / Go to Connections" buttons).
- **Storage is a Connection** — removed the "Drive folder ID" / "Hero file ID" inputs from the
  brief form (driveFolderId inert; heroFile written by the media agents as `local:<path>`);
  replaced with a disabled Media-storage picker (Local active | Google Drive coming-soon). DB
  columns kept.

### Token/cost dashboard — Phase 6 (`0e75e91`)
Per-node token/cost recorded on completion (LLM estimated from I/O, image flat per-image, stubs
$0); `getFlowCostRollup` sums across all instance runs of a flow template; the Flow blueprint
renders a spend strip (total $, tokens, post runs). Migration `node_token_cost`.

### Master-Agent create-post clarify + refine fix
- **Agent create-post clarify** (`5aeadc6`) — `POST /posts/from-agent` gates on missing
  high-impact brief fields (angle/platforms/format) and returns clarify questions before creating
  a generic post; the modal collects answers, which override the extracted values.
- **Conversational refine restored** (`89dc994`) — the chat-run lookup filtered on `kind`, which
  wrongly excluded a fresh draft (defaults to kind=instance) so every follow-up re-planned and
  re-asked. Fixed to filter on `templateId=null`.
- **Platform override** (`0dd2afe`) — a per-message "only facebook" now wins over the flow
  template's platforms in the campaign-from-flow path.

### Add-post modal + storage shell (`a7c9700`, `e20250c`)
Two-choice create modal (Manual | Master Agent field-filler); unified the sidebar `+`; sidebar
post delete; Connections page Storage section (shell).

### Post-board & Master-Agent feedback batch (items 1,2,5,6,7)
Seven user-reported issues from the buyer-demo dry run; items 1/2/5/6/7 shipped (3/4 pending).

- **Post platforms inherited (item 5)** — `POST /posts` now inherits the parent campaign's
  `platforms`/`language` when the brief omits them (an explicit body value still wins), so a
  post under a FB+IG campaign opens with those targets ticked instead of empty.
- **Single run affordance (item 6)** — for a flow-attached post (`post.runId`) the legacy
  "Generate copy" button is hidden; the DAG's Execute is the one path (concept_writer does
  copy-gen inside it). Run-less posts keep the legacy button.
- **Connection gate no longer swallowed (item 7)** — `post-workflow-view` renders the
  `ConnectionRequired` card on `needs_connection` (it only lived in saved-flow-detail before),
  so Execute on an unconnected platform shows the connect step instead of doing nothing.
- **Master Agent reuses a saved flow (item 2)** — chatting a saved flow to "create a campaign
  + first post" used to FORK a new flow and re-ask everything (a loop). New
  `campaign-intent.ts` (deterministic vi+en) + `campaign-from-flow.ts`: `POST /runs` detects
  the intent on a `kind=template` run and CREATES the campaign(+post) bound to that flow
  (`flowId=template.id`, post clones the DAG via `cloneTemplateRun`), returning
  `campaignIntent`/`createdCampaignId`/`createdPostId`; the panel navigates to the new board.
  Also: plan card shows "Publishes to:" chips + publisher node shows target platforms.
- **Storyboard independent of video (item 1)** — new `needsStoryboard` output flag; the
  planner selects storyboard on `needsStoryboard||needsVideo` and video only on `needsVideo`
  (video ⇒ storyboard). "bỏ video" keeps storyboard; "bỏ storyboard" drops both.
- **Verified** — verify-post-platform-inherit (5), verify-campaign-intent (10),
  verify-campaign-reuse-http (16), verify-storyboard-video-dep (14) + template-instance /
  save-offer / planner regressions green vs rebuilt container; backend tsc + web build clean.
- Plans: `plans/260702-1242-post-board-and-master-agent-fixes/`.

### Flow-as-Template · Post-as-Instance — 3-tier IA rework (not committed)
Split the coupled Flow-run/Post-run (`concept_writer` used to birth the Post inside the
flow's own run, so 1 flow = 1 post = 1 run) into **template ↔ instance**: a saved Flow is
a frozen blueprint reused across campaigns; each Post is its own execution instance.

- **Migration `flow_template_instance`** (additive) — `WorkflowRun.kind` (template|instance,
  default instance) · `locked` · `templateId` (SetNull) + indexes. Legacy rows default to
  instance → prior behaviour intact.
- **Save = freeze** — `nameRun` stamps `kind=template, status=template, locked` (keeps the
  `name:null` idempotency guard). `listSavedRuns` filters to templates → sidebar Flows shows
  only reusable blueprints. Master-agent refine/clarify skip mutating a template (explicit
  `kind==='template'` guard forks a fresh run). Executing a template → 409
  `template_not_executable`.
- **Clone-on-create** — new `cloneTemplateRun(templateId, ownerId, overrides)`: copies the
  template goal + DAG plan, merges the parent Campaign's strategy (product/angle/voice/
  language/platforms) onto the goal slots, creates an instance run (planned) + pending nodes.
  `POST /posts` calls it when the campaign has a `flowId` and links `post.runId`. Campaign
  with no flow → no runId (legacy copy-gen path preserved).
- **concept_writer instance path** — executor seeds `ctx.postId` from `getPostByRunId` so a
  pre-created Post is filled (copy-gen + approve) instead of materializing a new
  campaign+post; resets post→brief first so first-run AND re-run both regenerate. Legacy
  path (no attached post) unchanged. Fixes a re-run bug (posted post → `not_generatable`).
- **UI** — Flow detail renders a read-only **blueprint** (agent-team list with human roles +
  "New campaign from this flow" CTA, no execute/gate) when `kind==='template'`. Post
  workflow view is the **playground**: DAG open by default (no collapse toggle) + Execute +
  approve gate (moved off the flow) + existing re-run/refine.
- **Contract** — `WorkflowRunDto` gains `kind`/`locked`; openapi + web types regenerated.
- **Verified** — new `verify-template-instance` (22 checks: freeze, clone, no-dup-post,
  re-run stale) + `verify-api` rewritten to the new model; executor/rerun-node/save-offer/
  rename-creds/persistence/master/connect-form all green. Container rebuilt
  `--build --force-recreate`. DRY throughout (0 real posts, 0 Gemini spend).
- **Deferred** — token/cost dashboard (Phase 6): aggregate per-node token/$ across a
  template's instance runs. Model landed first per plan.

## 2026-07-01

### Flow ↔ Post convergence — P1–P6 (`b2415eb`)
Converged the two parallel systems (Orchestration Flow/Run DAG ↔ Campaign→Post pipeline)
so a post exposes its whole workflow and the Master Agent can guide setup. One commit,
48 files, 2 migrations. All verify suites + Puppeteer browser e2e green; DRY (no real posts).

- **P1 Connect via form** (no migration) — `getActiveToken()` falls back to the credential
  vault (`publisher/<platform>_access_token`) after an OAuth miss, fixing the
  `META_APP_ID not set` connect blocker. `/connections` counts form creds as connected;
  inline token form in ConnectionsPanel.
- **P2 Post.runId + DAG under post** (migration `20260701064554_post_run_link`, SetNull) —
  `concept_writer` stamps `Post.runId`; `RunDagView` renders under each PostCard with live
  SSE dots + clean artifact view (image restored).
- **P3 Preflight honors form creds** — connection-resolver unions OAuthToken + form-cred
  platforms so the $0 pre-execution gate sees both.
- **P4 Single-node re-execute** — `POST /orchestration/runs/:id/rerun-node/:nodeId`; resets
  target + transitive downstream to stale (NOT auto-run — keeps image/video spend
  deliberate); publisher re-run blocked (approve-node gate).
- **P5 Text-refine + per-post voice/angle** (migration `20260701090147_post_voice_angle_overrides`) —
  `POST /posts/:id/refine {instruction}` edits copy via LLM (audit trail kept);
  `Post.angle`/`Post.brandVoice` overrides layered post→campaign→user.
- **P6 Master-Agent save-offer** (no migration, no contract change) — after `/save`, the
  agent authors a guiding offer (set up first campaign $0 / run test post ~$0.06 / open
  flow) returned as `assistantMessage` + persisted on the chat; web `SaveOfferCard` + a
  "flows without strategy" hero hint. **Fix:** `nameRun` now guards on `name: null`
  (first-save-only) so a re-`/save` can't re-post the offer — caught by the live-HTTP e2e,
  missed by the DB-level test.

### Flow-creation UX + §11.15 hardening (`4706f1f`, `67182e5`)
- `+ New flow` / empty-state route into the Orchestrate chat; static `brandingVideoFlow`
  retired. Inline flow rename via `PATCH /orchestration/runs/:id` (any status).
- Per-agent credential setup on real nodes; allowlist re-keyed backend+web to snake_case
  registry ids (kebab → 422).
- §11.15 hardening: idempotency (audit-log, no migration) + in-process rate-limit + retry
  in `invokeAction`, dormant under DRY.

## 2026-06-30

- **Sidebar IA** (`993a212`) — merged Saved/Active Flows into one `Flows` tree
  (Flow→Campaign→Post); `Campaign.flowId` FK (SetNull); create at each level.
- **Retire old Master Agent setup surface** (`4993964`) — Orchestrate is the sole chat entry.
- **Connector/Credential Layer §11 P2–P5** (`d5da344`) — credential vault, connector
  registry, runtime, external-action audit log.
- **Connection Resolver gate** (`2008729`) — runs needing an unconnected platform stop at $0
  before the DAG.
- **Product knowledge + persona capture & Saved Flows UX** (`6c35373`).
- Language + sidebar fixes (`f146068`, `73b7aa4`, `065961c`).

_Earlier history predates this changelog; see git log and memory notes._
