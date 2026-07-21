# Project Changelog

Significant changes to the MKTAgent backend (the plain-TS marketing pipeline on
`pivot/video-content-farm`). Newest first. Commit hashes are on that branch.

## 2026-07-21

### Fix: a depleted prepaid balance no longer ships a silently truncated video
Follow-up to the quota classifier below, after the free-tier premise was retracted. This deployment
is on a **paid prepaid** tier, where the realistic stop is not a daily quota but the credit balance
reaching zero — and per Google's billing doc that arrives as **`429 RESOURCE_EXHAUSTED` with the
message `Your prepayment credits are depleted`**, carrying *no* quota metadata. Same envelope as an
ordinary rate limit, so the first classifier would have defaulted it to per-minute, retried it, and
truncated the video exactly as before.

`QuotaScope` gains `billing`, matched narrowly on `deplet` / `insufficient credit|balance|funds` —
deliberately **not** on the word "billing", which appears in the ordinary rate-limit copy ("check
your plan and billing details") and would misclassify every burst as a dead account. Pinned by test.
`isDailyQuotaError` → `isTerminalQuotaError` (`scope !== 'minute'`): retrying cannot help either a
spent daily quota or a dead balance. The billing message names the remedy (top up in AI Studio) and
the blast radius — Google stops **every API key on the billing account**, so this is never a
video-only outage.

There is **no API to read the prepaid balance**; it is AI Studio UI only. Cloud Billing API does not
expose it, so a Phase 02 balance pre-flight cannot be built the way it was scoped.

### Fix: a daily provider-quota stop no longer ships a silently truncated video
Gemini's free tier is **3 requests/min and 10/day**, and `runVideo` spends one image + one Veo call
per shot — so a 5-shot video is the entire daily quota. Both 429 kinds were handled identically:

- **Per-minute burst** — clears in <60s, so backing off was right.
- **Per-day exhaustion** — does not clear today. `veo.ts` burnt ~3.5 min of backoff (25/50/75/75s)
  to reach the same failure, and `runVideo`'s per-shot catch then counted it as a flaky shot and
  returned `degraded: true`. The user waited ~10 minutes and received a 2-shot video with no reason
  given. That is worse than a clean refusal.

`lib/quota-error.ts` classifies the two by reading the `RESOURCE_EXHAUSTED` payload — the
`QuotaFailure` violation's `quotaId` (`...PerDayPerProjectPerModel-FreeTier` vs `...PerMinute...`)
and `RetryInfo.retryDelay`. An unrecognised or non-JSON body classifies as **per-minute**, so an
unexpected shape degrades to the previous retrying behaviour rather than to a hard stop.

- `withRetry` skips its schedule for a daily error only; per-minute 429s keep the old path (the
  error carries `status = 429`, so the existing status taxonomy is untouched).
- `veo.ts` throws immediately on a daily quota, and now honours `retryDelay` as a floor on the
  per-minute backoff (capped at 90s).
- `nano-banana.ts` raises the same typed error from its 429 branch.
- `runVideo` re-throws a daily quota instead of degrading, naming the model, how many of N shots
  rendered, and that the finished ones are cached — resuming is genuinely free because `veo.ts` and
  `nano-banana.ts` are content-hash filesystem caches on the persisted `mktagent-media` volume.

`degraded` stays reserved for what it was meant for: the flaky "200 with no image" case.
Verified by `lib/verify-quota-error.ts` (new) plus four cases added to `verify-video-script.ts`.
Suite is 70/70.

Phase 01 of `plans/260721-1343-video-length-and-quota-budget/`. Phases 02 (pre-flight quota budget)
and 03 (user-chosen length) are unstarted and blocked on measuring whether the image model shares
Veo's 10/day bucket.

### Feat: `video_script` agent — video decoupled from storyboard
New 19th registry node. The video DAG becomes `content_concept → video_script → video`; **storyboard
leaves the video path entirely** and keeps its own job (detail frames + the carousel deliverable).

Why: `video` read `storyboard` frames, which describe STILL compositions and carry captions written
for images. It fed that still-description to Veo as a motion prompt, spoke the image captions aloud,
and hardcoded 8s per frame (`snapDuration(8)`), so a 5-frame plan was always exactly 40s. Motion,
pacing and speech are different jobs from framing, so they now get their own planner.

`video_script` emits per shot: `imagePrompt` + `motion` (English, model input), `brief` + `narration`
(run language, human-facing), and `durationSec`; plus a mandatory 3-second `hook` and closing `cta`.
`runVideo` renders its own keyframes (anchor-conditioned for consistency, ported from `runStoryboard`)
and animates each with that shot's own motion and duration.

`video.requires` was asserted in **7** places — registry, `requirement-prompt.ts`,
`orchestration-mappers.ts`, `goal-merge.ts`, `deterministic-analyzer.ts`, the dedicated verify script,
and the golden snapshot. `verify-storyboard-video-dep.ts` is inverted to pin the new invariant and
asserts storyboard is **absent** from a video-only plan (a stale edge would silently bill 3–6 unused
images). Golden snapshot regenerated; diff reviewed line by line.

### Feat: infographic is a real overview planner, not a string template
`runInfographic` had **no LLM call** — a fixed sentence with slots, identical for every product, with
`no text overlay` hardcoded into a node named "infographic". Its registry `decisionFramework`
described reasoning that no code performed. It now goes through the same prompt-as-data path
`storyboard` uses: `promptSections` + an output contract, planning layout, on-image text (expected,
in the run language) and aspect ratio from the target platforms. Deliverable unchanged — exactly one
image, `assetType: 'image'`, publish validation untouched.

### Fix: user-facing text mixed English and the run language
Model-input fields (`imagePrompt`, `motion`) are English because image/video models perform best in
English — but they were being **rendered to the user** next to localized narration, so a shot card
read half Vietnamese, half English. `artifact-format.ts` had also been showing infographic's English
`Image prompt` to users since well before this change.

Fixed by the split the codebase already used for infographic (`visualBrief` localized /`imagePrompt`
English) and had simply not applied elsewhere: `video_script` shots gained `brief`, and no
model-input field is rendered. Language-agnostic by construction — `buildAgentPrompt` pins the
resolved run language, verified live in Vietnamese, Indonesian and Korean. `verify-video-script.ts`
now asserts the split in the contract text so it cannot regress silently.

### Feat: the video cost gate shows what you are approving
`web/src/components/video-script-review.tsx` — shots, durations, narration, hook, CTA and estimated
Veo spend. Previously the gate said *"review the frames above"*, which was true when video rendered
from already-generated storyboard frames; with the new DAG nothing is generated yet at that point, so
the user was approving the most expensive step in the system while shown nothing about it.

Four renderers needed updating, not one: both gate blocks (`post-workflow-view`, `saved-flow-detail`),
a separate `statusHint` string, and `artifact-format.ts` (which had no `video_script` case and fell
back to raw JSON).

### Other
- `goal.slots.videoTarget` (`feed|reels|tiktok|shorts|youtube`) steers the video's cut. Deliberately
  **not** a `platforms` value: that enum is Prisma-backed and means "publish here", so adding
  tiktok/youtube would make the publisher fail `no target platform can publish this post`.
- `stitchFn`/`muxFn` added to `RunnerContext`. Every other media op was injectable; ffmpeg was not, so
  a DRY-RUN video run shelled out on stub paths.
- `orchestration/testing/stub-llm-json.ts` — the same LLM stub was copy-pasted in 5 verify scripts and
  all 5 broke at once when a contract was added.
- Docs: `docs/README.md` index added; 7 superseded `next-session-*` handoffs moved to `docs/archive/`.

## 2026-07-15

### Fix: bug batch from observed browser tests (`9f915fa`)
- **BUG-3 gate-after-content**: the connection gate no longer parks the whole DAG before generating —
  `/execute` + `/test-run` defer the pre-gate when the plan produces a reviewable draft (concept parks at
  the selection gate); the executor re-gates connection at the publisher boundary (parks `needs_connection`
  instead of letting `runPublisher` throw); `respondRun` recomputes `requiredActions` on read. Un-connected
  tenants can now review a draft pre-connect.
- **Data Guard >40k chunking**: `runSecurity` scans the whole document in windows (fail-closed per window)
  and concatenates masked output — no tail dropped; `runSummarize` map-reduces beyond one window.
- **S9 recipient-carry**: the brain seeds `resolvedLead` from the prior turn's goal → stops re-asking "who to?".
- **Web**: calendar slot fields wrap (no truncation); document-attach control added to the landing view.

### Feat: lead-nurture agent — two-way, human-gated (`e4e8f5c`)
Drip state machine (day 0/3/6, atomic-claim, park-per-touch) + `gmail.readonly` reply ingestion + threading
+ nurture brain (classify→draft→state, global opt-out, prompt-injection hardened) + Nurture Inbox UI +
guardrails + e2e. `src/nurture/`. Every send is human-approved; flags default OFF. Live-validated 2026-07-15.

### Feat: multi-channel nurture nodes — DRY-RUN scaffold (`d789bfd`)
DM node (`dm_writer→dm_agent`, whatsapp/telegram/zalo adapters, `isLiveDmSend` gate, opt-in refusal),
mention/reply greeting node (additive `SocialAdapter.mention/reply` per each platform's real API limit),
and comment-capture hardening (signed Meta webhook + handle-only leads + X/LinkedIn gating). All adapters
default DRY-RUN — no real send without an explicit token + `ENABLE_LIVE_*` flag.

### Fix: live-test findings (`2375f01`, `c981737`)
- **Copy edit/refine on saved-flow-detail** (`2375f01`): the run-detail view reached via "Approve & run now"
  (`saved-flow-detail.tsx`) never had the edit/refine controls and stayed stuck on "Running…" (SSE reloaded
  only on completed/failed). Shared `concept-copy-editor` extracted; edit/refine + rerun + reload-on-park
  added; `/edit-copy` now syncs the concept artifact so hand edits persist.
- **Credit reconcile-debit + fail-no-charge** (`c981737`): debit fired only at completion, so parked runs
  that spent tokens were never charged. New `reconcileRunDebit` (delta above already-debited, advisory-lock
  serialized) called from a `finally` wrapping the executor body — charges at every park/completion. `/refine`
  spend now billed. **A failed run charges nothing** (product decision). Migration
  `credit_wallet_multi_debit_reconcile` drops the one-debit-per-run unique index.

## 2026-07-14

### Feat: credit wallet + super-admin grant console (all 3 phases + logout)
`pivot/video-content-farm`. Plan `plans/260714-1815-credit-wallet-admin-grant`. Turns "credits" from a
spend-display into a real **wallet** with balance, gating, and a super-admin grant surface. Payments
still deferred. New-tenant trial = **2000 credits** (user-set). 1 credit = 250 tokens (unchanged).
- **Ledger (P1)**: new `mkt_credit_ledger` (append-only, balance = SUM(delta); kinds trial/grant/debit/
  adjust). Idempotency: `@@unique([runId,kind])` = one debit per run (grant/trial rows use runId=null,
  NULL-distinct). `User.isSuperAdmin` flag. `credit-repo.ts` (getBalance/grantCredits/debitRun/
  ensureTrialGrant — the trial made race-safe with a tx-scoped `pg_advisory_xact_lock`). Debit fires at
  a run's TRUE terminal completion, best-effort (a wallet error never fails a completed run). Trial
  granted idempotently on login. `scripts/set-superadmin.ts` bootstrap.
- **Gate + UI (P2)**: `executePlannedRun` (+ `/runs/:id/test-run` + the brain's "run it" path) returns
  **402 `insufficient_credits`** at balance ≤0, ORDERED before the connection gate; chat/planning is
  never routed here so it stays free. `/auth/me` echoes `credits`(balance) + `isSuperAdmin`. Top-nav
  pill = remaining balance; Usage page "Credits remaining" line; friendly 402 copy at every execute
  call-site. **Logout button** wired in the top nav.
- **Super-admin console (P3)**: `requireSuperAdmin` middleware → **404** for non-admins (surface hidden,
  not 403). `admin-router.ts`: `GET /admin/tenants`, `POST /admin/grant`, `GET /admin/capability-
  requests` (platform-wide demand backlog). `SuperAdminPage.tsx` at the hidden `/superadminatria101`
  route (URL-detected, never in nav).
- **Verified**: `verify-credit-wallet` 16/16 (incl. concurrent-trial race) + `verify-credit-gating-and-
  admin-http` 9/9 (live server, real auth/middleware, no LLM/publish spend). Both tsc clean.

## 2026-07-13

### Feat: demo-readiness full-fix — Atria brain grounding, email-by-name, voice + strategist UX
`pivot/video-content-farm`. Plan `plans/260713-1743-demo-readiness-full-fix`. Commits `ae95f52`
(feature) + `5eeff26` (prior campaign fix) + `84482a9`/`e339870` (constellation). No thin layers;
6 scenarios driven live in-browser (P6) — which caught + fixed 4 bugs the API/verify tests missed.
- **Instructions ground the brain (P4)**: `resolveWorkspaceInstructionsBlock` → injected as a DYNAMIC
  preamble in `runAtriaBrain` (never the context-cached system prompt → no tenant leak) AND threaded
  into the requirement analyzer, so proposed pillars/angle/tone honor the user's Instructions, not
  just the downstream content agents.
- **Memory smarter (P5a)**: `memoryContext` injected into the brain EVERY turn (fixes "forgets
  mid-chat"); product-keyed angle capture; recall ranking `score*10 + priority*4 + usedCount*.6 +
  recency*2`; product is an always-eligible default (fixes cross-language recall); `GET/DELETE
  /memory/facts` + a "What Atria remembers about you" panel. P5b embeddings deferred (YAGNI).
- **Email to a lead by NAME from chat (P3)**: `find_lead` brain tool resolves a lead by name/handle
  (masked email to the model; authoritative recipient from the Lead RECORD, never a model string);
  `runEmailWriter` grounds the draft on the lead; `markLeadNurtured` on send. New `goal.slots.leadId`.
  Brain prompt: an email is never "posted to a platform", personal emails skip marketing framing,
  resolve+propose in one turn.
- **Voice one-button + JARVIS core central (P1, FE)**: the Atria core is the single two-way voice
  toggle and stays large + central in chat mode (was collapsing to 132px). `OrchestratePanel` exposes
  a voice handle via `forwardRef`; App mirrors the state so the core reflects + toggles it.
- **Strategist campaign inline in chat (P2, FE)**: `PlanCard` variants (🗓 Strategist / ✉️ Email /
  📄 Single post); executing a strategist plan polls to its selection gate and renders the editable
  content calendar INLINE in the transcript (approve → materialize → grant, no navigation).
- **Constellation = true circle**: group + member radii aspect-corrected (pixel radius ÷ box
  dimension) so every group is equidistant from Atria instead of sitting on an ellipse.
- **Verify**: BE+FE tsc clean; golden 23/23 + campaign-intent + reuse-http 21/21 + platform-inherit
  6/6 = no regression; new `verify-instructions-and-memory` + `verify-nurture-email-from-chat` green.
  Deferred-to-manual: P1 real STT (needs a mic), P3 real Gmail send (needs the user's connected
  account — DRY send + `nurturedAt` stamp already green).

### Fix: campaign/flow intent confusion + platform inheritance
`5eeff26`. `detectCampaignIntent` → create/plan/ambiguous (cadence words need noun-pairing) so a clear
create message with "schedule" no longer trips PLAN_INTENT and reproduces a new flow; campaign created
under a flow inherits the flow's platforms/language (facebook fallback) instead of persisting `[]`.

## 2026-07-12

### Feat: generic scheduler agent node (deferred-execution, type-agnostic)
`pivot/video-content-farm`. Plan `plans/260712-1129-generic-scheduler-agent-node`. One reusable
`scheduler` registry node lets ANY flow defer its terminal action to a confirmed future time. The
scheduler performs NO action — it PARKS the run and a single generic cron re-enters the executor at
the parked node when due. First consumer: scheduled email ("send tomorrow morning"). The existing
publisher `scheduledAt` + `runSchedulerTick` path is **untouched** (coexists).
- **Data model**: `WorkflowRun.scheduledResumeAt` (nullable Timestamptz) + `@@index([status,
  scheduledResumeAt])`; migration `20260712061605_generic_scheduler_resume_at` (additive, safe).
  New first-class `GoalSpec.schedule { at, phrase, timezone, confirmed }`; `mergeGoals` carries it.
- **Time parse + confirm** (`orchestration/atria/parse-schedule-time.ts`, `set_schedule` tool):
  Gemini parses NL time → absolute UTC instant + IANA tz; Atria ALWAYS reads the exact instant back
  and the user must confirm before it becomes bindable (covers parse ambiguity + sender-vs-recipient
  tz). Unconfirmed never parks.
- **Registry + planner**: `scheduler` node (gate `schedule`, emoji ⏰, produces `schedule_marker`);
  `planWorkflow` splices it before the terminal action (`email_agent`/`publisher`) only when the goal
  carries a CONFIRMED schedule — explicit edges writer→scheduler→action. No schedule → plan unchanged.
- **Executor + approve path**: the generic `requiresApproval` halt provides the schedule-gate HALT
  (draft produced first for review); approving parks directly (`parkScheduled`: status='scheduled',
  scheduledResumeAt, scheduleConfirmed, scheduler node completed) instead of running inline.
- **Resume cron** (`scheduler/resume-due-runs.ts`, `ENABLE_SCHEDULER_RESUME`): own advisory lock key
  + atomic `claimScheduledDue` (scheduled→running) → `runWorkflow` with `approveNodeId = downstream
  action` (waives that one gate). Resume-safe executor skips completed writer+scheduler. `<= now`
  catch-up (missed windows fire late, never lost). A resume failure ends `failed` (no re-queue).
- **Frontend**: Scheduled page "Scheduled sends" section (list + Cancel + Reschedule); flow card
  renders the ⏰ scheduler node + a "Scheduled for {local time}" chip. New endpoints `GET
  /runs/scheduled`, `POST /runs/:id/cancel-schedule`, `POST /runs/:id/reschedule`.
- **Verify**: `orchestration/executor/verify-scheduler-node.ts` (21 checks) PASS DRY — halt→park→
  single-send re-entry, double-fire guard (lock + atomic claim), unconfirmed/completed skip,
  failure-no-requeue. Backend + web typecheck green; regression suites unchanged; Docker boot green.

## 2026-07-10

### Fix: strict bool env parse, grant visibility, SSE multiplex, verify reconciliation (demo-ready polish)
`pivot/video-content-farm`, commits `21f5d73..11a152c`.
- **F3 — strict boolean env parsing** (`21f5d73`): `boolEnv()` replaces `z.coerce.boolean()` so
  `ENABLE_*` flags respect literal "false"/"0" (coerce.boolean made every non-empty string true,
  breaking the ability to disable autonomy/scheduler/leads crons). File: `src/config/env.ts`.
- **F5 — grant-eligibility filtering** (`11a152c`): threaded `campaignId` through `WorkflowRunDto`
  (schema + mapper + regen web types); per-post autonomy grant ("⚡ Chuẩn bị") now hides on
  standalone (non-campaign) posts (previously 409 "not_a_campaign_post"). Files:
  `workflow-run-repo.ts`, `orchestration-mappers.ts`, `schemas.ts`, `post-workflow-view.tsx`.
- **F4 — SSE multiplex onto one stream** (`11a152c`): all live-update hooks (`use-post-events`,
  `use-run-events`, `use-workspace-events`, `use-agent-activity`) previously each opened an
  EventSource to `/events` → 3+ standing streams/tab, hitting the HTTP/1.1 ~6-connection cap,
  stalling fetch(). New ref-counted singleton `events-bus.ts` opens ONE /events connection, fans
  frames to all subscribers. Browser-verified: 1 EventSource with multiple hooks. File:
  `MKTAgent/web/src/hooks/events-bus.ts`.
- **F7 — verify reconciliation (test, not executor)** — product decision locked: (1) text-only posts
  ARE allowed to publish (no media) — X/Threads/LinkedIn/FB accept text. `verify-executor`
  reconciled to assert text-only reaches `posted` (was stale "fail-loud"). (2) Manual flow keeps
  TWO gates: concept selection parks at the publisher gate (does NOT auto-publish); only
  autonomy runs auto-publish via the scheduler. `verify-concept-gate` reconciled; no executor
  code changed, only stale test assertions.

## 2026-07-09

### Feature: Demo-readiness P1/P2/P3 + post-QA fixes (`d6dcf30`→ latest, `pivot/video-content-farm`)
Plans `plans/260709-1947-demo-readiness-refine/` (build) + `plans/260709-2128-demo-fixes-p4-p5/` (QA fixes).
- **DTO seam** (`d6dcf30`): `approvalMode` (`human|atria`) exposed on `WorkflowRunDto` (schema + mapper + regen web types).
- **P1 — per-post grant on the post view** (`29826f7`): "⚡ Chuẩn bị" 2-step grant next to Execute on
  `PostWorkflowView` (forecast → confirm), an "Atria đang chuẩn bị" state + 8s auto-advance poll while
  `approvalMode==='atria'`, and the per-post credit forecast on the confirm chip.
- **P2 W1 — neural-graph node light-up** (`25cb9b8`): new `use-agent-activity` hook subscribes to the
  shared `/events` SSE and lights the working agent node (`node.status=running`), flows energy along its
  edge, and pulses a "conducting" core; lit nodes surface even in the collapsed chat hero.
- **P2 W2/W3** (`2f55683`): dark-restyle of the Atria suggestion/resume cards inside the CC; workspace
  count badge on the Workspace ▾ switcher.
- **P3 VOICE V1/V2** (`b99630e`): `POST /voice/tts` (Gemini TTS via `src/video/tts.ts`; owner-scoped,
  cost-tracked, filesystem-cached, 4000-char clamp) + read-aloud speaker buttons on Atria reply bubbles
  and the Impact headline (single-narration-at-a-time). TTS live-verified (206KB WAV, ~5s, cached). V3
  auto-narrate deferred.
- **Post-QA fixes** (latest commit): a 4-agent QA swarm (reviewer/red-team/tester/QA-planner; reports in
  `plans/reports/*260709-2100*`) found one real safety-consent gap — a granted **scheduled** post
  auto-publishes for real while the UI said "dừng ở review." Resolved via **Option B** (copy now reads
  "Atria tự đăng theo lịch" across all 4 grant surfaces; behavior unchanged). Also: atria dead-end
  recovery (Execute restored on failed/needs_connection since the cron only re-claims `planned`), a 32s
  "preparing" watchdog, read-aloud double-click ref-guard, and a per-owner `/voice/tts` throttle.
  DEFERRED to a follow-up plan: SSE-stream multiplex (3rd standing connection), hide-grant-on-non-campaign,
  strict env boolean parse, reconciling 2 stale verify assertions, and all of P4/P5.

### Feature: Command Center Unification — top nav, Atria chat merged into the CC, "alive" animation
Big frontend re-architecture (`plans/260709-1359-command-center-unification/`). Commits `5c47904`
(P1) → `019b92b` (P3), all on `pivot/video-content-farm`.
- **P1 — global top nav, no left sidebar** (`top-nav.tsx`, `app-nav.ts`): all nav moved to a dark top
  bar (page items + Workspace ▾ + Chats ▾ + credits/theme/user); `.app-root` became a rows grid with a
  clamped column so wide children scroll internally.
- **P2 — Atria chat hosted INSIDE the Command Center**: App builds `OrchestratePanel` once and passes
  it to the CC as `chatSlot`; idle = neural graph + command bar + Atria suggestions/resume cards
  (P2.0), chat active = graph collapses to just the Atria hero, transcript below (dark-restyled, scoped
  to `.cc-chat-embed`). Retired the standalone `page:'orchestrate'`. Unified the "workspace" concept:
  removed the Workspaces nav item; the Workspace ▾ dashboard drawer is the single entry with a
  "Mở board" button to the deep PostBoard/DAG.
- **P3 — "alive" animation (VISUAL only, no `generateContentStream`)**: `TypewriterText` reveals new
  Atria replies char-by-char with a caret; the Atria core "breathes" while a chat is open.

### Feature: per-post autonomy grant ("Chuẩn bị" — prepare + park at review)
`POST /posts/:id/grant-autonomy` (2-step: Step-1 returns this post's cost estimate + token, Step-2
flips the run to `atria`). The autonomy runner now runs granted runs with `autoPublish:false` so they
run the pre-steps then PARK at `needs_approval` for the user to edit + apply tone; the scheduler
publishes after approval. UI "⚡ Chuẩn bị" button (inline cost-confirm) on planned campaign posts in the
Workspace dashboard AND the Scheduled list. Reuses `grantAutonomy`/`plan-estimate`/grant-token.
Forecast is per-agent accurate (video 18cr = concept+storyboard+video+publisher; image 9cr =
concept+infographic+publisher). Commits `66faf26`, `af2c6bc`.

### Feature: measured Insights extended to Threads + X (`de6a7bb`)
`threads-insights.ts` (views→impressions, likes/replies/reposts/quotes→engaged; reach null) +
`x-insights.ts` (`public_metrics` via /2/tweets; degrades to null on free tier / rate limit). Merged
null-aware into Impact (4-way FB+IG+TH+X). All four platforms live-verified.

### Fix: token force-refresh + several CC-chat bugs
- **`06c610a`** — a stale token (`needs_attention`/expired) with an untrustworthy far-future expiry
  never attempted a refresh (the "X won't renew" bug). `refreshIfDue` gains a `force` flag; the stale
  path forces one refresh and flips status back to active on success (self-heal).
- **`8a2c9b2`** — the CC chat re-fired the LLM on every remount (tab switch / refresh) because the
  prefill was never consumed. Explicit `ccChatOpen` state + `onAutoStarted` clears the prefill +
  restore-on-return; no duplicate spend.
- **`0096d48`** — an acted Atria suggestion reappeared on returning to the landing and could be
  re-fired; the acted set now lives in `CommandCenterPage` (survives the chat toggle).
- **`d4da71b`** — "repeat what worked" now names the completed product (`lastCompletedProduct`) so the
  user knows which campaign and Atria gets concrete context instead of re-asking.
- **`c1cfa87`, `c1f6426`** — embedded-chat transcript scroll + composer pinning; chat-mode graph
  gathers to just the Atria hero.

## 2026-07-08

### Fix: WOW-audit tech-debt batch — 5 phases (P0/P1/P2, code green, uncommitted)
Clears the read-only audit's findings (`plans/260708-0346-project-wow-audit/`) after resolving 4
product decisions with the user. tsc (server + web) + pure `verify-atria-suggestions` green; DB-backed
verifies + the link-status migration pending a running database.
- **Link-status persistence (P0-3, user-observed)**: added `Post.linkStatus Json?` (migration
  `20260708120000_post_link_status`). `checkPostLinks` now persists the liveness snapshot + timestamp
  unconditionally (single write covers persist + self-heal; new `persist` param defaults true, the
  verify seam passes false). Exposed in the post DTO + client type; `LeadsPage` hydrates it on load so
  ⚪/🔴/🟢 survives a refresh instead of resetting to blank.
- **Impact ↔ Usage credit reconcile (P0-4)**: `impact-metrics.ts` split the media aggregate —
  `mediaPieces` counts ALL media rows, but the credit basis now sums only tokenless media USD
  (`totalTokens:0`), mirroring the Usage page so the two totals agree (image gens no longer
  double-count once in tokens + once in USD). `usdSpent` unchanged.
- **Campaign proactivity (decision: no auto-widen)**: kept the single-post default; escalation flows
  through Atria's proactive suggestions. Added the "leads spiking on one product → plan a campaign for
  it" signal (`signal-reader` lead-per-product groupBy + `atria-suggestions` R1b, rank 90). Accepting
  it prefills the existing "Plan a month…" intent that escalates to the strategist calendar.
- **Autonomy kickoff (decision: auto-run but DRY)**: NEW `ENABLE_AUTONOMY_CRON` granted-run executor
  (`src/orchestration/autonomy/*`). Every 2 min it atomically claims `approvalMode='atria' + planned`
  runs and executes them through the SAME gated executor (the fail-closed policy still guards each
  gate); publishing is forced DRY-RUN so the autonomous loop completes end-to-end without a real post.
- **Auto-publish (decision: default OFF + toggle)**: goal-level `autoPublish` flag; the analyzer
  detects a hands-off command ("đăng luôn", "auto-publish"); executor defaults OFF and honors, in order,
  the caller's explicit toggle → the goal flag → the gate. `/execute` accepts a per-run body toggle;
  `executeRun` client seam ready for the UI switch (deferred to the UI phase).
- **Polish**: registry `implStatus` `stub`→`live` for the three fully-live media agents
  (infographic/storyboard/video); `materialize-calendar` logs partial-failure counts + reasons
  (response already carried `skipped`); two Vietnamese clarification seeds made language-neutral so the
  no-LLM fallback doesn't leak VN to other-language users; `recordGeminiCall` warns on a real call that
  returns no `usageMetadata` (undercount edge now auditable).

### Fix: Atria UX feedback pass 1 — Plan-it auto-send, campaign report in replies, hub redesign
User feedback on the campaign-intelligence release (3 items):
- **"Plan it" swallowed the intent**: accepting an Atria suggestion (or a Command Center command)
  only prefilled the Orchestrate composer — nothing was sent, so no run was created and the
  strategist never planned. `OrchestratePanel` gains `autoStart` (ref-guarded, fresh mounts only):
  a non-empty handed-over intent now auto-submits, so the campaign plan card appears immediately.
- **Atria replies now open with a latest-campaigns report** (campaign-scope turns only): NEW
  `orchestration/atria/workspace-report.ts` reads the tenant's 5 most recent campaigns (posts,
  live counts, recent post titles) — threaded into `conversationAuthor` context + prompt; campaign
  plans are voiced as full proposals (duration/cadence/calendar) ending with an explicit approval
  ask. Deterministic no-LLM fallback renders the same report. Best-effort (report failure never
  blocks a turn); single-post turns unchanged (no extra queries).
- **Atria hub redesigned assistant-first**: default view = Ask-Atria box (auto-sends), Atria
  reminders (suggestion cards, now with empty state), and "Continue where you left off" cards
  (unfinished chats + flows with no campaign, NEW `atria-resume-work-cards.tsx`). Instruction
  editor + impact report moved behind Instructions/Impact tabs so the landing no longer reads as
  a setup page/dashboard. Proper CSS (`.atria-*`) replaces the inline-style cards.
tsc (server + web) + vite build green; verify-master, verify-campaign-strategist,
verify-atria-suggestions green.

### Feat: Atria campaign intelligence + content quality + impact — 8 phases (commit `953903e`)
Plan `plans/260708-0108-atria-campaign-intelligence-quality-impact/`. Turns Atria from a single-post
generator into a proactive campaign strategist with expert + user-customizable content quality and a
value/ROI report. Fully additive — single-post planning is byte-identical. tsc (server + web) green;
9 new DRY-RUN verify suites + executor/planner/campaign-intent/refine regressions green.

**Content quality (Phases 01–02) — the foundation, lifts every agent.**
- `orchestration/prompts/build-agent-prompt.ts` (NEW): ONE builder assembles each agent's system
  prompt in layers — expert base (registry `promptSections`) → language → user instructions →
  a strict JSON **output contract that is appended LAST so it always wins**. Flat prompts in
  `agent-prompts.ts` refactored into `AGENT_OUTPUT_CONTRACTS` (schemas identical → no runner break).
  ideation/strategy/storyboard runners route through it; expert `promptSections` authored for each.
- `mkt_instruction` table (migration `atria_user_instructions`): layered, ChatGPT-style user
  instructions — scope `workspace|campaign|post`, optional `agentId`, `source user|memory` (the
  Memory-Agent seam). `resolveInstructions` composes most-general→most-specific + agent-scoped;
  injected into EVERY agent via the builder AND copy-gen. Hard guardrails still win. `/instructions`
  CRUD. `build-agent-prompt`, `resolve-instructions`, `instruction-repo`, `instructions-router`.

**Campaign engine (Phases 03–05).**
- GoalSpec `campaignScope (single|campaign|spotlight, default single)` + `duration`/`cadence`;
  deterministic analyzer detects multi-post intent NARROWLY (bare "campaign" stays single so the
  existing rich single-post flow is untouched); Gemini analyzer unions the deterministic scope.
- `content_calendar` artifact + `campaign_strategist` agent (Intelligence, `gate:selection`) — a
  research-backed, editable N-slot calendar. Scope-aware planner: campaign → content_search? →
  ideation → strategy → campaign_strategist, then STOPS (per-post work belongs to the posts).
- `scheduler/schedule-calendar.ts` (pure, tz-aware via Intl, injectable `now`) ACTIVATES the dormant
  `Campaign.postingWindow`+`timezone`. `master/campaign-materializer.ts`: each slot → single-scope
  GoalSpec → `planWorkflow` → instance run + Post(`runId`, `scheduledAt`, `assetType`). Idempotent
  `POST /campaigns/:id/materialize` (sweeps un-published, never touches a posted post).
- Campaign-scoped HMAC double-confirm grant (`autonomy-grant-token`): one confirm flips EVERY
  materialized post's run to `atria` in one audited action (`grantAutonomyForCampaign`), per-post
  guardrails unchanged. Upfront whole-calendar cost estimate + per-campaign ceiling (`campaign-grant`).
  `POST /campaigns/:id/grant-autonomy` + `GET /campaigns/:id/status` (derived dot rollup).

**Proactivity + proof (Phases 06–07).**
- `orchestration/atria/signal-reader.ts` (no PII — structural counts only) + `atria-suggestions.ts`
  (deterministic rules → ranked, explainable nudges: plan-a-month, repeat-a-winner, pitch Email,
  pitch Memory). `registry/roadmap-agents.ts` + `mkt_roadmap_demand` log (migration
  `atria_roadmap_demand`). `GET /atria/suggestions` (dedups pitches), `/atria/roadmap-demand`.
- `impact/impact-metrics.ts` (REAL: cost from the `mkt_llm_usage` ledger, published posts, media,
  leads by `sourceProduct`, run minutes — reconciles with the Usage page) + `impact/value-model.ts`
  (CONFIGURABLE agency baseline → saved $/time + estimated reach, all clearly LABELED as estimates).
  env `IMPACT_*` constants. `GET /campaigns/:id/impact` + `/impact?period=`.

**UI v2 (Phase 08).**
- `web`: client DTOs/methods; components `instruction-editor`, `atria-suggestion-cards`,
  `content-calendar` (edit → materialize → 2-step grant with upfront cost), `campaign-command-view`
  (8s poll board), `impact-report`, `atria-hub-page`. New sidebar page ✦ **Atria**.
- Calendar mounted into the strategist gate: `SavedFlowDetail` special-cases the
  `campaign_strategist` selection gate → renders the calendar. Bridge `POST
  /orchestration/runs/:id/materialize-calendar` creates the campaign FROM the run goal, materializes,
  resolves the gate, returns `campaignId` (UI then grants). `artifact-format` renders the calendar.

**Deviations from plan (deliberate):** did NOT add a `campaign_plan` run `kind` — `WorkflowRun.kind`
is already `template|instance` with dependent queries; campaign plans are identified by the
`content_calendar` artifact instead. Per-campaign leads attributed by `sourceProduct` (`mkt_lead`
has no campaign FK). Campaign cost ceiling = per-run ceiling × post count.

**Open:** live-auth browser e2e (Google login) — see `docs/atria-campaign-intelligence-e2e.md`; real-
Gemini smoke of the strategist + the expert-prompt quality lift (verifies use stubs, zero spend).

## 2026-07-07

### Feat: Atria Command Center page (Phase 04) + agency-agents prompt mining (Phase 05-B)
Report `plans/reports/researcher-260707-0753-agency-agents-mining.md`. Two parallel, non-conflicting streams.

**Command Center ("Neural Network" landing) — new page, additive, page-scoped dark theme.**
- `web/src/components/command-center-page.tsx` (NEW): Atria core + agent nodes on an ellipse,
  coloured by real division; live credit badge. It is a FUNNEL, not a second app — clicking a node /
  the core / the command bar redirects into the existing Orchestrate surface (`onLaunch`, optional
  prefill), and `⌂ Workspace` exits back to Flows. No re-implementation of orchestrate/workspace.
- `GET /orchestration/agents` (orchestration-router): serves the registry as display data (groups +
  nodes) so the view renders REAL agents, no decorative fakes.
- `OrchestratePanel` gains optional `initialInput` — the command typed on the Command Center is
  carried once into a fresh composer (no lost input).
- Dark theme confined to `.command-center` (page-scoped CSS vars) → zero global churn, fully
  reversible. This is the deliberate safe-move: adopt the command-center look without a global reskin.

**agency-agents mining (MIT, attribution `docs/agency-agents-attribution.md`).**
- Enriched all 8 runnable agents' persona fields (vibe / decisionFramework / successMetrics; +
  `promptSections` for concept_writer + publisher) from 7 marketing personas: growth-hacker →
  Strategy (+ lead-scoring rubric); content-creator/instagram/linkedin/carousel → Editor;
  multi-platform-publisher → Publisher; seo-specialist → Researcher.
- 0 schema changes, 0 new agent ids, 0 DAG wiring changes — persona text only; tsc clean.

Verify: backend + web `tsc --noEmit` green (after `prisma generate` — client was stale vs the
`platform_post_ids` migration); `vite build` green; `/orchestration/agents` payload confirmed real
(8 nodes, 3 groups). Live screenshot deferred (stack not running).

## 2026-07-06

### Fix: trustworthy per-platform post-liveness / deleted-post detection (commit `e89aa2e`)
Report `plans/reports/verify-260706-2007-lead-collector-gone-signal.md`. Live verification found the
lead-collector "is this post still live?" check mis-reported deletion on 4 of 5 platforms: LinkedIn
(403 on the consumer tier) and X (conversation-search returns empty for both deleted and no-reply
tweets) were read as `alive:true` on **deleted** posts; IG/Threads matched only by accident because a
permalink shortcode never resolves on Graph (code 100). Only Facebook was reliable. Fixes:
- Capture the canonical resolvable `platformPostId` at publish (IG/Threads numeric media id was
  fetched then discarded; FB `{page}_{post}`; X tweet id; LinkedIn urn) → persisted in a new additive
  column `platform_post_ids`; `recordCommentSources` prefers it so activate-from-Leads no longer
  falls back to an unresolvable shortcode.
- New `post-exists.ts` `checkPlatformAlive` tri-state (`true`/`false`/`null`) — never asserts alive
  unless positively confirmed. FB/IG/Threads query the comments/replies edge (clean `subcode 33` gone
  signal vs the ambiguous `code 10` of a direct object GET); IG/Threads gated by `isNumericId`;
  LinkedIn always `null` (unreadable on `w_member_social`); X `GET /2/tweets/{id}` parses
  `errors[].resource-not-found` (returned at HTTP 200, not a 404).
- Poller comment-fetchers only trust the gone signal on a resolvable id → a legacy shortcode can no
  longer false-deactivate a live collector. `isMetaGraphPostGone` tightened to `404 || subcode 33`
  (dropped bare `code 100`, the generic invalid-param bucket). `extractPostId` reads `?v=` for FB
  watch/video URLs. Leads UI shows a per-link tooltip (🟢 live / 🔴 deleted / ⚪ can't-verify).

Verified live vs 2 real posts → FB=false, X=false, IG/Threads/LinkedIn=null; tsc clean; 5 verify-leads
suites green. Known limits: old shortcode-only posts stay ⚪ for IG/Threads (un-backfillable — IG
oEmbed needs Facebook app review); LinkedIn liveness is ⚪ until a tier upgrade (`r_member_social`).

### Fix: concept_writer wiped user copy edits on re-run (edit-loss)
Report `plans/reports/debug-260706-1703-concept-edit-loss.md`. Since copy-gen was merged into
concept_writer, re-executing the concept node (flow continue / re-run) unconditionally regenerated
copy — wiping the user's manual `/edit-copy`, version `/select-variant`, AND AI `/refine` (chosen→0).
No edit-protection existed. Fix: new `post.copyEdited` flag (1 migration) set by all three user-edit
paths + cleared on fresh generation; `runConceptWriterForExistingPost` now PRESERVES edited copy
(emits it as the artifact, no LLM/cost) unless it's an explicit rework or the post is unedited.
verify-edit-loss 7/7 green.

### Fixes: publish-before-video, version count, lead-collector robustness
- **Scheduled publish waited for the flow** — the cron published a post at its scheduled time even
  while its video was still generating. Now `hasActiveFlowNodes` gates the cron: a due post whose
  run has running/pending nodes is DELAYED (left due, retried next tick) until the flow finishes.
  Also: approving the video cost gate no longer auto-publishes (autoPublish suppressed when the plan
  has a video node → separate publish approval), and the publish gate holds + notifies if any step
  is still in progress (future-proofs parallel execution).
- **Concept version count is user-controlled** — was hardcoded to 4; now `post.versionCount`
  (migration), set at creation via the brief form, **default 1** (a single version, no forced picking).
- **Lead collector — deleted-post detection** — the Graph fetcher swallowed a deleted-post error
  (returned []), so the poller watched dead posts forever. Now it detects Meta "object gone" (code
  100 / subcode 33 / HTTP 404) vs transient/auth, removes that platform's watch source, and marks
  `post.leadCollectorStatus='post_deleted'` (migration) when none remain → UI shows "stopped — post
  deleted". A re-publish reactivates it. Fixed a multi-platform accumulator bug (deletions now
  accumulate, not last-write-win). verify-leads-post-deleted 7/7.
- **Lead-collector cron** — `ENABLE_LEADS_CRON` runs the comment poll globally every 30 min (auto
  pull leads), not just the manual trigger.
- **Copy-gen JSON truncation** (`8763f7c`) — disabled gemini-2.5 thinking on copy-gen (was starving
  the output budget → "Unterminated string") + variant-salvage on truncation.

### Phase 03: kill switch + tier-selection wiring (safety layers)
- **Kill switch** — `src/system/kill-switch.ts` + `mkt_system_flag` table (migration). Global
  external-actions pause checked FIRST at the connector-runtime chokepoint (`invokeAction`) — a
  paused system refuses every outbound write platform-wide, audited. Run-level **abort**: `POST
  /orchestration/runs/:id/abort` flips the run to `aborted`; the detached executor honors it at each
  node boundary (new `getRunStatusById` + between-node check). `GET|POST /orchestration/killswitch`
  toggles the global pause (audited). verify-kill-switch green.
- **Tier-selection wiring** — `POST /orchestration/runs/:id/apply-tier {tierId}` rebuilds the run's
  plan from the chosen Economy/Balanced/Full variant (deleteNodes + replanRun + createNodes) so a
  subsequent execute runs that DAG. Guarded to pre-execution state.

### Phase 03: credit model + multi-tier plan cards
- **Credit model** — `src/cost/credits.ts`: friendly `credits` = real tokens / a display divisor
  (250; 15k tokens ≈ 60 credits) — transparent passthrough, no markup. `credits` now rides on the
  run cost, flow rollup, and `GET /orchestration/usage`. verify-credits 9/9.
- **Multi-tier plans** — `plan-tiers.ts` derives Economy/Balanced/Full goal variants, plans + dedupes
  each, and estimates credits from REAL per-agent history (`agentCostAverages`, global fallback) via
  `plan-estimate.ts`. `GET /orchestration/runs/:id/plan-tiers` returns the selectable cards.
  verify-plan-tiers 11/11. (Flow "pick a tier to run" + web cards = follow-up.)

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
