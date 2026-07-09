# Senior Red-Team — Autonomy + Publish Safety (pre-demo)

Date: 2026-07-09 21:00 · Branch: `pivot/video-content-farm` · Scope: read-only trace of the per-post
autonomy grant → cron → executor → scheduler chain against the invariant **"nothing may post to a real
external platform without an explicit human approval."**

Work context: `C:\Users\Vincere\Desktop\Claude\AgentPortal\MKTAgent`

---

## VERDICT: **AT-RISK** (the DRY-only safety story is BROKEN; a human grant is still the sole gate)

The literal invariant technically holds *only if* you accept the two-step grant handshake as the
"explicit human approval." But the safety mechanism the task and the code comments claim guarantees it —
**"the autonomy path publishes DRY-RUN only (`dryAutonomyPublish`)" and "must PARK at needs_approval
before the publisher"** — is **factually bypassed** on the normal (scheduled) campaign-post path. The real
publish is done later by the **scheduler** with the **real** `runtimePublishFn`, not by the autonomy
runner, so the DRY publishFn never runs. The UI simultaneously promises the user the run will "dừng ở
review" (stop at review) while authorizing a real auto-publish. That gap is the exact
unwanted-real-post / Meta-ban business risk the invariant exists to prevent.

### Single strongest piece of evidence
`src/orchestration/autonomy/autonomy-runner.ts:51-55` forces `{ autoPublish: false, publishFn:
dryAutonomyPublish }` believing this "parks before the publisher … the DRY publishFn is a
belt-and-suspenders no-op." But in **atria mode `autoPublish:false` is a no-op** — the executor's human
auto-publish waiver is guarded `if (!atriaMode …)` (`workflow-executor.ts:331`), and the executor itself
documents "In atria mode the grant policy is the sole authority" (`:329-330`). For a scheduled post the
atria publish gate is auto-cleared when guardrails hold (`:353-377`): the post is parked **`ready`** and
the run **completes** — the publisher node (and thus `dryAutonomyPublish`) is **never reached**. The
scheduler then publishes it for **real** via `runtimePublishFn` (`tick.ts:29,192,228`), gated only by
`scheduleConfirmed` — which **every** grant UI path sets to `true`
(`post-workflow-view.tsx:162`, `scheduled-view.tsx:44`, `workspace-panel.tsx:53`, `content-calendar.tsx:48`).

---

## The real end-to-end state machine (traced)

Per-post grant on a "brief" campaign post (`posts-router.ts:441-466` / `orchestration-router.ts:350-371`):

1. **Grant** → `grantAutonomy(runId, ownerId, scheduleConfirmed=true)` sets
   `approvalMode='atria', scheduleConfirmed=true`; run **stays `planned`**
   (`workflow-run-repo.ts:409-419`). Backend 2-step token handshake is sound — a single stray call
   cannot enable autonomy (`orchestration-router.ts:360-362`).
2. **Cron claim** (`autonomy-cron.ts`, `ENABLE_AUTONOMY_CRON`, every 2 min) →
   `claimNextGrantedRun()` atomic `updateMany` guarded on `status:'planned'`
   (`workflow-run-repo.ts:505-517`). **Atomicity is correct** — double-claim returns count≠1 → null.
3. **Executor** `runWorkflow(atria, autoPublish:false, publishFn:dryAutonomyPublish)`:
   concept/media run, then the publisher node. Campaign posts carry a `scheduledAt` (from
   `materializeCalendar`), so `isScheduledFuture()===true` → the **scheduled atria branch**
   (`workflow-executor.ts:348-379`):
   - `atriaApprovalPolicy('publish', ctx)` (`approval-policy.ts:49-53`) returns `approve` when
     `connected && mediaReady && cleanlyPostable && contentChecksPass` — **all true on the happy demo
     path** (platforms connected, media generated, `contentChecksPass = !!postId`).
   - → `approveOrThrow` flips the post review→**ready** preserving `scheduledAt`, node **completed**, run
     **completed**. **No park at review. `dryAutonomyPublish` never executes.**
4. **Scheduler** (`tick.ts`, `ENABLE_SCHEDULER_CRON`, every min) at `scheduledAt`:
   `findPublishDueBatch` → the ready post → `isPublishBlocked(runId)`
   (`workflow-run-repo.ts:193-205`): run `completed` (not non-terminal); `approvalMode==='atria' &&
   !scheduleConfirmed` is **false** (scheduleConfirmed=true); 0 parked nodes → **NOT blocked** →
   `claimForPublish` → `processPost(post, runtimePublishFn)` = **REAL external write.**

Net: a granted campaign post publishes to the real platform at its scheduled time with **no
post-generation human review**, contradicting the UI copy "Atria đang chuẩn bị nội dung rồi dừng ở
review" (`post-workflow-view.tsx:165`) and the code comment "The cron then prepares it + parks at review"
(`:157`).

> Note on intent: this real auto-publish is what `isPublishBlocked`'s own comment
> (`workflow-run-repo.ts:189-191`) and `approval-policy.ts:3-7` **intend** — grant = authorized
> end-to-end, `scheduleConfirmed=true` = "human re-confirmed, OK to auto-fire." So the *engine* is
> internally consistent as full autonomy. The defect is that (a) the **autonomy-runner + task's DRY-only
> guarantee is a false description** of what protects the wire, and (b) the **new per-post grant UI (commits
> 66faf26/29826f7) tells the user it will stop at review while passing `scheduleConfirmed:true`** — a
> consent mismatch, not a matching mental model.

### Asymmetry worth knowing for the demo
- **Scheduled** post (future `scheduledAt`, the calendar norm) → **REAL** publish via scheduler (unsafe vs. the promise).
- **Immediate** post (no/`past` `scheduledAt`) → executor's immediate atria branch (`:386-398`) auto-clears the gate and runs the publisher node with `ctx.publishFn = dryAutonomyPublish` → **DRY**, post marked `posted` with fake `https://dry-run.atria/...` URL. Safe but produces a misleading "posted" state.

So the DRY publishFn only ever protects the immediate case; the scheduled case — the one the calendar
actually produces — is real.

---

## Campaign-level grant vs per-post grant
No divergence in the publish decision. `grantAutonomyForCampaign` (`workflow-run-repo.ts:425-438`) flips
every grantable run to atria with the same `scheduleConfirmed`, guarded per-run to
`planned/failed/needs_connection` (a running/posted run is left alone → no retro-grant, no double
publish). `content-calendar.tsx:48` also passes `scheduleConfirmed:true`. Same real-auto-publish behavior,
fanned across N posts — **larger blast radius** (a whole calendar can auto-fire), same root path.

---

## Race analysis
- **`claimNextGrantedRun` double-execute** — SAFE. Atomic guarded `updateMany` (`:512-516`); loser gets
  count 0 → null. Overlapping 2-min ticks cannot double-run a run.
- **Frontend 8s poll vs cron** (`post-workflow-view.tsx:83-87`) — SAFE. Poll is a **read-only**
  `getRun` view refresh; it cannot start/publish anything and clears on unmount. No race with the cron.
- **`/rerun-node` TOCTOU** — STILL FIXED. `transitionRun(full.id, owner, full.status, 'running')` claims
  **before** `resetNodes`/`deleteArtifacts` (`orchestration-router.ts:512-518`); the loser 409s and
  mutates nothing. Already-posted publisher reset is refused (`:500-505`).
- **Scheduler vs executor double-publish** — SAFE. Executor parks a scheduled post `ready` and never
  inline-publishes it; `claimForPublish`/`claimForPublishOwned` atomic claims are the single
  serialization point (`tick.ts:214-225`). One publish chokepoint (`runtimePublishFn`).

---

## Newly-added seams (db0e65f..HEAD)
- **`POST /voice/tts`** (`voice-router.ts`) — **auth OK** (`server.ts:133` `requireAuth`). Cost bounded
  per call: `MAX_TEXT=4000` clamp + FS cache by (model,voice,text) hash → repeats free, `$0.02` charged
  only on real synthesis. **Gap: no rate-limit** — an authed user can spend unboundedly by varying text
  each call (each miss = 1 Gemini TTS call + `$0.02`). Low blast radius (authed, self-cost), **not a
  demo-blocker**. Minor: reads the whole WAV into memory (`readFile`) — fine at this text cap.
- **2nd SSE EventSource** (`use-agent-activity.ts:25`) — **no leak.** Returns `es.close()` on cleanup
  (`:42`); the server unsubscribes on `req.on('close')` (`events-router.ts:53-56`) and the bus deletes
  empty owner sets (`bus.ts:54-59`). Cost is 2 SSE connections per tab (this hook + `useRunEvents`)
  instead of 1 multiplexed — acceptable, could be merged later.
- **Read-aloud audio singleton** (`read-aloud-button.tsx`) — client-only Blob playback, no server state,
  no safety surface.

---

## Scheduler / stuck-run safety (item 5)
- A granted run's post **does** get a `scheduledAt` (materialized calendar) and, after the executor parks
  it `ready`, the scheduler **will** fire it — no stuck state on the happy path.
- If guardrails DON'T hold (disconnected platform / missing media / unsupported asset), the executor
  `atriaHold`s → node `awaiting_approval`, run `needs_approval` (`workflow-executor.ts:207-213,
  386-396`) → genuinely parks at review (matches the UI promise **only** in the failure case).
- Reaper (`reaper.ts`) covers stuck `posting`/`running` nodes/runs and surfaces (never deletes) orphaned
  `needs_approval`/`planned` runs. `isPublishBlocked` holds the scheduler off any run still parked/producing.
  No stuck-forever path found.
- Crons default **OFF** (`env.ts:19,68,80`); real behavior depends on the deployment `.env` (memory notes
  crons are enabled there). With crons off, nothing auto-runs — but the demo env likely has them on.

---

## Top 3 risks (ranked)

1. **[DEMO-BLOCKER for the safety narrative] Granted scheduled posts really auto-publish with no
   post-generation review, while the UI promises "dừng ở review."** The DRY publishFn does not protect
   this path; `scheduleConfirmed:true` (set by every grant button) authorizes the real scheduler publish.
   Trigger: grant a "brief" campaign post whose platforms are connected → cron prepares → scheduler posts
   for real at `scheduledAt`. Blast radius: one real post per grant (whole calendar for campaign grant).
   Fix options: (a) make the per-post/campaign grant pass `scheduleConfirmed:false` so the scheduler holds
   and the user must approve at review (matches the UI copy); or (b) change the UI copy to state it will
   publish automatically at the schedule and drop "dừng ở review." Either realigns promise and behavior.

2. **[MEDIUM] The autonomy-runner's DRY-RUN guarantee is a false mental model that will mislead operators
   during the demo.** `autonomy-runner.ts:20-27,51-55` and the task brief both assert "autonomy publishes
   DRY only / parks before publisher," but the real wire write is the scheduler's `runtimePublishFn`.
   Anyone reasoning about safety from the runner file will conclude it's safe when the scheduled path is
   not. Fix: correct the comments and, if DRY-only is truly desired for the demo, gate the *scheduler*
   (not the runner) for atria runs — e.g. keep `isPublishBlocked` true for atria runs until an explicit
   per-post approve stamps a separate flag distinct from `scheduleConfirmed`.

3. **[LOW] `/voice/tts` has no rate limit** — authed users can drive unbounded Gemini-TTS spend by
   varying text (cache only helps identical text). Not a publish-safety issue; add a simple per-owner
   token-bucket / daily cap before exposing broadly.

---

## What is genuinely SOLID
Atomic run claim; `/rerun-node` TOCTOU fix; single publish chokepoint; `isPublishBlocked` covering
parked/producing runs; reaper self-healing; SSE unsubscribe correctness; backend-enforced 2-step grant
token; per-run grant-state guard preventing retro-grant of running/posted runs; DRY protection of the
immediate-publish autonomy sub-case.

**Status:** DONE_WITH_CONCERNS
**Summary:** Safety invariant is AT-RISK — the "autonomy is DRY-only / parks at review" guarantee is
bypassed on the scheduled path; granted posts real-publish via the scheduler under `scheduleConfirmed:true`
while the UI promises a review stop.
**Concerns:** Consent/behavior mismatch (risk #1) is a demo-blocker for the safety story; recommend
aligning `scheduleConfirmed` with the UI copy before demoing the grant flow.
