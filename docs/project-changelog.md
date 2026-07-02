# Project Changelog

Significant changes to the MKTAgent backend (the plain-TS marketing pipeline on
`pivot/video-content-farm`). Newest first. Commit hashes are on that branch.

## 2026-07-02

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
