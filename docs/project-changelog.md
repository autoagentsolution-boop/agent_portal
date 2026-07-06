# Project Changelog

Significant changes to the MKTAgent backend (the plain-TS marketing pipeline on
`pivot/video-content-farm`). Newest first. Commit hashes are on that branch.

## 2026-07-06

### Gemini cost accounting — real per-owner usage ledger (fixes ~100× undercount)
Audit `plans/reports/audit-260706-1532-gemini-cost-accounting.md`. Symptom: 500K Google credit
burned but tracking showed ~$5. Three compounding causes fixed:
- **Real usageMetadata incl. thinking tokens.** `node-cost.ts` now costs from actual
  `promptTokenCount` + `candidatesTokenCount` + **`thoughtsTokenCount`** (Gemini 2.5 internal
  reasoning, billed at output rate — the biggest miss) + `cachedContentTokenCount` at the cached
  rate. Per-model `PRICING` (flash/flash-lite/pro/gemini-3) so a pro call isn't priced as flash.
  char/4 `estimateLlmCost` kept only as a fallback. Veo now priced per-second ($0.05/s → $0.40 for
  an 8s clip, was a $0.20 flat).
- **Universal ledger.** New `mkt_llm_usage` table (1 migration) — EVERY public model call records
  `{ownerId, surface, model, promptTokens, outputTokens, thoughtTokens, cachedTokens, costUsd}`.
  Wired at every surface that was previously **invisible**: chat (conversation/requirement/save-offer),
  intake (gemini-intake-provider + agent-router), copy-gen (service.ts — covers DAG + standalone +
  cron), lead rescore, product analysis, and the DAG runners + media (image/video/tts). Grounded
  research adds a $0.035/request surcharge. Record-once per physical call; stubs/cached record nothing.
- **Analysis surface.** `GET /orchestration/usage` → per-owner total + per-surface breakdown (the
  billing/business-strategy view). `src/cost/llm-usage.ts` (`recordGeminiCall`/`recordMediaCost`/
  `usageTotals`). verify-llm-usage 16/16 (incl. DB round-trip) green.

### Fix: media-only goals were unplannable (empty-plan guard / verify-master)
`concept_writer` (sole producer of `content_concept`) was planned only for `needsTextPost`, so any
infographic/storyboard/video-only goal had an unsatisfiable dependency → `plan_error`. Now the planner
adds `concept_writer` for ANY content-bearing output, and the empty-plan guard treats `storyboard` as
intermediate (not a standalone deliverable) → a storyboard-only goal falls back to a text post.
verify-master now fully green (was 2 pre-existing failures).

### Atria Phase 02 (agent layers) + Phase 05-A (agent schema) — committed ef255bb, 1e54cd9
Plan `plans/260706-1040-atria-mvp-leads-priority/` (phases 02 + 05). No migration (all additive Zod
artifact-schema fields, no Prisma change). Verified: verify-researcher, verify-publish-timing,
verify-leads-criteria, verify-memory + the existing suites (executor/planner/api/leads) all green;
`tsc` clean; container rebuilt.
- **05-A agent schema** — `AgentDefinition` += additive persona fields (emoji/group/vibe/successMetrics/
  decisionFramework/promptSections); new `agent-groups.ts` (Intelligence/Action/Assistant division
  taxonomy); all 8 registry agents authored with persona + group. Existing DAG wiring untouched.
- **Researcher (net-new, `content_search` stub→live)** — `src/agents/researcher/`: Gemini
  `google_search` grounding (no new provider) → `research_summary` with citations. `runResearch`
  never throws (missing grounding tier → knowledge-only fallback). New `researchFn` DRY-RUN seam.
- **Memory facade** — `src/memory/profile-facade.ts`: `getProfile`/`getProduct`/`remember` over the
  ProductKnowledge library + user defaults (owner-scoped, no new table). Consumed by Phase 04 UI.
- **Product Expert** — clarification-engine bounded product-depth probe: a 12–40 char productDetails
  ("skincare serum") gets one more required round for differentiator/proof/fit (loop-safe — a
  substantive answer clears it). Raises the thin-product substance bar without touching the tuned gates.
- **Strategist ↔ Lead Collector bridge** — `leads/scoring/criteria.ts`: weights are now data
  (`LeadScoringCriteria`); `ruleScore(input, criteria?)` (defaults reproduce old scores exactly); the
  Strategist proposes criteria from funnel stage/audience onto the `strategy_brief` artifact.
- **Publisher optimal-time** — `src/agents/publish-timing/`: pure heuristic best-window suggestion,
  surfaced at the publisher approval halt (SSE `timingSuggestion`) + recorded on `publish_result`.
- **Known pre-existing red (NOT this diff):** verify-master 2 checks fail on the empty-plan guard for
  a storyboard-only goal — confirmed present on baseline `1abe71b`.

### Lead Collector — Atria Phase 01 (per-tenant, encrypted, scored, comment-capture)
Full Lead Collector vertical (plan `plans/260706-1040-atria-mvp-leads-priority/phase-01`). 4 additive
migrations. Verified by 5 suites (verify-leads-{tenancy,pii,scoring,comments} + verify-api).
- **Per-tenant intake tokens** (`c44b29b`) — `LeadIntakeToken` (sha256 hash, plaintext once); funnel
  presents `x-intake-token`/`?t=` → lead lands on that owner (was hardcoded SYSTEM_OWNER). Legacy
  global secret → system owner. mint/list/revoke routes.
- **PII encryption** (`4e8fb08`) — name/email/phone/message AES-256-GCM in lead-repo; dedupe on
  `email_bidx` (crypto.blindIndex, keyed HMAC); raw_payload no longer persisted. backfill script.
- **Hybrid scoring** (`fa6f89e`) — rule layer (deterministic, on capture) + LLM `POST /leads/:id/rescore`.
- **Leads UI** (`a0a53e8`, `527bd96`, `1abe71b`) — 🎯 Leads page: intake setup + scored table +
  💬 Active lead collectors (posts watching comments).
- **Comment-keyword capture** (`140b40a`) — per-post `Post.leadCaptureKeyword`; comment on published
  FB/IG with keyword + email → opt-in lead. `commentSourceIds` recorded at publish write-back (§01.6
  wiring). comment-parse/poller (injectable fetcher) + graphCommentFetcher (live FB/IG). `LeadSource
  += comment`. Live-verified: post 75f70734 poll reached FB Graph API.

### X publishing fixed + publisher/media/UX fixes
- **X publish** — root cause was a token lacking write scopes; fixed via OAuth Connect (PKCE) after
  `PUBLIC_BASE_URL=http://localhost:7100` (X allows localhost callback) + callback without trailing
  slash. Refresh-token field on the X card (`30abf48`); X media-403 → text-only tweet (`3a70fad`).
- **Publisher image auto-degrade** (`4c8f412`) — carousel/video post reuses an image (carousel frame /
  infographic / hero / upload) for image-only platforms instead of skipping.
- **Edit-brief 500** (`8d27726`), **campaign posts summary+drill-in** (`3b85803`), **product knowledge
  visibility + import + library** (`d2959aa`, `527bd96`, `1abe71b`), **per-node runtime+tokens**
  (`894559e`), **Veo 429 retry** (`34fc47d`), **concept versions review-mode** (`b9203c9`), **PK/Leads/
  Flows peer sidebar** (`dc34dbd`, `527bd96`).

### Atria v2 plan
`plans/260706-1040-atria-mvp-leads-priority/` (5 phases): Lead Collector first (done), then agent
layers, orchestration+credit, UI adaptation, and adopting the `agency-agents` agent-definition schema.

## 2026-07-05

### Concept versions (3-5) + selection gate + reference-image upload
concept_writer now offers **N=4 distinct copy versions** (one LLM call) for the user to pick from,
then an optional reference image before media generation.
- **Versions** — `buildVariantsBody`/`parseVariants` + `generateVariantsForPost`; `content_concept`
  artifact carries `variants[]` + `chosen` (post.copy = the active version). `POST /posts/:id/select-variant`.
- **Selection gate** — executor `SELECTION_GATE={concept_writer}` PAUSES right AFTER concept executes
  (node `awaiting_approval`, run `needs_approval`); `approve-node(concept)` approves the post
  (review→ready) + resumes. `conceptGate` opt (default true) on `/execute`; `false` = auto-pick v1.
- **Reference image** (optional, non-blocking) — `Post.referenceImage` (migration); `POST/DELETE
  /posts/:id/reference-image` (20mb parser via `post-media-router`). With a media step it conditions
  infographic/storyboard gen (Gemini edit mode; storyboard anchors every frame on it); with NO media
  step `asHero=true` writes it straight to the post media. `save-uploaded-image.ts`.
- **UI** — `ConceptSelectionGate` (version cards + upload + Continue) in PostWorkflowView.
- Verify: `verify-concept-gate.ts` 17 checks green. Commits `46e5cfa` / `a18a0c8` / `5804f97`.

### Per-platform asset type (item 5) — different deliverable per platform
- Migration: `Post.platformAssets` ({platform:assetType}) + `Post.assetMedia` ({assetType:refs}),
  both nullable → legacy posts unchanged.
- Publish fan-out (`tick.processPost`) resolves each target's own asset type + media, with a
  carousel→first-frame degrade (FB carousel, single image elsewhere) and skips unsupported targets
  with a reason. Executor generates each DISTINCT asset type once → `attachPostMedia` per type.
- Brief-form per-platform asset picker (`platformAssetSupport` mirrors adapters).
- Verify: `verify-per-platform-publish.ts` 18 checks green. Commits `e3c68c5` / `5ed92d9` / `0db79d8`.

### Product Knowledge LIBRARY (item 6) — reusable per-user store
- `ProductKnowledge` entity (migration) + nullable FKs `campaign.productKnowledgeId` /
  `post.productKnowledgeId` (SetNull → content survives). Repo CRUD + merge + `resolveLinkedKnowledge`.
- `/analyze` now optionally creates a new library entry (`saveToLibrary`) or merges into an existing
  one; resolution chain for media grounding: post.pk → campaign.pk → brandContext → goal slot.
- UI: save-to-library toggle on the upload panel + a library dropdown on the brief form.
- Verify: `verify-library.ts` 14 checks green. Commits `11f937a` / `1de445f`.

### Publish flow — per-platform validation, publish review, auto-publish (items 1-3)
- **Item 1** (`5dc96ec`): `social/postability.ts` — adapter `supports` is the runtime truth (FB does
  carousel/video; IG/Threads/LinkedIn/X image-only). Publish skips incompatible targets with a reason.
- **Item 3** (`f1d5465`): `GET /posts/:id/postability` + `PublishReview` at the gate (asset support +
  connection state). `api/connection-state.ts` extracted (connections list reuses it).
- **Item 2** (`e3cd89c`): publisher gate WAIVED by default when the post is cleanly postable; halts for
  the review only when a target can't take its asset. Pre-video cost gate untouched. `autoPublish` opt.
- **Item 4** (`e723979`): concept_writer↔copy-gen boundary documented (not redundant); `finalizeConcept`
  DRY'd. Report in `plans/reports/`.

### Product Knowledge — upload documents → Gemini analysis → grounds every prompt
Thin product knowledge was the cause of generic copy/images/video. New capability: the user
uploads documents/images about the product and Gemini's multimodal model reads them into a rich,
factual profile.
- `src/product-knowledge/analyze-documents.ts` — `generateContent` with `inlineData` (PDF/images)
  + text parts (txt/md); returns a composed `productDetails` + `brandVoice` + `language`. Cost from
  REAL `usageMetadata` (first real-token plumbing — document tokens are counted).
- `POST /product-knowledge/analyze` — files as base64 in JSON (no multipart dep); a 20mb route
  parser is mounted BEFORE the global 1mb limit. Optional `campaignId` persists the profile to
  `campaign.brandContext`. Auth-scoped; 415 for unsupported types, 422 empty, 502 upstream.
- Wiring: copy-gen already read `brandContext`; the IMAGE/VIDEO prompts (`buildImagePrompt`,
  storyboard, `goalContext`) now fall back to it too — so analyzed knowledge reaches the media
  subject, not just the copy.
- UI: `product-knowledge-upload.tsx` on the campaign board (📚 panel) — upload → extracted profile
  + token cost → saved to campaign. Live-verified: 611 tok / $0.0005 on a sample doc.
Commits: `0bf11a6` (backend), `0c80d80` (media wiring), `d522709` (UI).

### Asset-type-aware media pipeline + pre-video cost gate + carousel
- **assetType drives media** — executor skips media nodes the chosen assetType doesn't need
  (carousel/image never pay for the video pipeline; infographic can't clobber a carousel). Media
  agents set assetType to match their output (fixes "carousel needs >=2 assets"). `assetTypeFromOutputs`
  derives post.assetType from the plan outputs across all create paths (concept_writer /
  createCampaignFromFlow / goalToBrief) so the gating runs the right steps.
- **Storyboard branches on assetType** — carousel = business-explainer slides (own prompt) published
  AS the carousel (frame-CSV hero); video = cinematic keyframes stitched into one mp4.
- **Pre-video approval gate** — `video.requiresApproval` halts BEFORE the costly Veo step so the user
  reviews the storyboard first; the gate reads the LIVE registry so it applies to existing runs; a
  deliberate video re-run stays allowed. **TTS voiceover** now counted in the video node cost (`49ba524`).
- **Carousel is selectable** in intake ("Text + carousel") and the analyzer distinguishes a carousel /
  multiple images from a single infographic.

### Master Agent robustness — language, clarification loop, platforms
- **Two language domains, separated** — content follows the SETUP (post→campaign→user), the chat
  mirrors the user's INPUT. Tightened VN detection (≥2 unaccented hits; added stacked-tone diacritics)
  so English stops flipping to Vietnamese; prompts forbid language mixing.
- **Fixed the never-ending clarification loop** — refine turns were analyzed in isolation, so a short
  reply never mapped to a slot → `product` stayed empty → asked forever. Refine now hands the analyzer
  the prior goal as context; a personal post's topic/angle counts as its subject; the deterministic
  platform parse is unioned into the Gemini result so a named platform is never dropped.
- **Mandatory platform ask** on BOTH Master-Agent surfaces (Orchestrate flow + "Create with Master
  Agent" post modal) — never silently defaults to Facebook.

### UX / robustness
- Live per-node elapsed timer + spinner; optimistic running state closes the SSE race (a re-run video
  step now shows "processing" immediately). Idempotent post-approve (a stale card no longer dead-ends).
- Persist `output/` via a named Docker volume so generated media survives container rebuilds.
- Veo: retry the start call without `generateAudio` when the (silent-tier) model rejects it; guard a
  missing storyboard frame on disk with an actionable message instead of a raw ENOENT.

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
