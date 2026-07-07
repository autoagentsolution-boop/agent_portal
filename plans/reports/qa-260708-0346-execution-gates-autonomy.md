# QA Audit — Execution Lifecycle, Gates & On-Behalf Autonomy (domain B)

Date: 2026-07-08 | Read-only static audit. No source edited, app not run.
Scope: flow(DAG)→campaign→post(clone)→execute→approval gate→publish + Atria on-behalf autonomy + asset-type gating.

---

## Verdicts (file:line evidence)

### Q1 — Real approval GATE before external publish (human path)? ✅ present, waivable-by-design
- Gate lives in `workflow-executor.ts:398-416`: a `requiresApproval` node sets node→`awaiting_approval`, run→`needs_approval`, RETURNS. No publish happens. Resume only via `POST /runs/:id/approve-node/:nodeId` (`orchestration-router.ts:393-404`), which requires run status=`needs_approval`.
- `requiresApproval` is read from the LIVE registry (`workflow-executor.ts:315` `getAgent(...).requiresApproval`), not the frozen plan — good (policy changes apply retroactively).
- **Bypass by design (not a bug, but demo-relevant):** auto-publish default ON (`orchestration-router.ts:305`, executor `:325,:329-340`). When the post is "cleanly postable" (every target adapter supports its asset type) the publisher gate is WAIVED and it publishes with NO human click. So the "gate" only actually stops when a target can't take the asset OR a video cost gate exists (`hasCostGate`, `:123,:325`) OR schedule-future (`:346`). For a plain FB text/image post the human path publishes with zero approval.
- Single external-write chokepoint confirmed: both executor (immediate) and scheduler (`tick.ts` header + `:29`) call the same `runtimePublishFn`. No shadow path. ✅

### Q2 — On-behalf autonomy: machine-approve + execute+publish without human? ⚠ seam REAL, but NO autonomous KICKOFF
- **Seam is real, not stubbed.** `autonomy-grant-token.ts:17-40`: HMAC(JWT_SECRET) double-confirm, scoped to (runId,ownerId) / (campaignId,ownerId), timing-safe compare. Step-1 issues token w/o granting, step-2 echoes it (`orchestration-router.ts:331-341`, `campaigns-router.ts:150-169`). A lone stray call cannot grant. ✅
- **Policy is real + fail-closed.** `approval-policy.ts:36-55`: publish gate requires ALL of connected∧mediaReady∧cleanlyPostable∧contentChecksPass else `hold`; cost gate holds if `budgetUsd===null` or over ceiling; selection needs content produced. Executor applies it at `workflow-executor.ts:384-396` (immediate) and `:346-353` (scheduled). A held gate PARKS (`atriaHold` `:207-213`) + audits + notifies — never publishes, never fails. ✅
- **Stale-attachedPost / fresh-goal auto-publish bug is FIXED.** Both the human waiver (`:335`) and `buildGuardrailCtx` (`:165`) RE-READ the post FRESH via `getPostByRunId(runId)` at the boundary, falling back to the run-start snapshot only on miss. So a fresh-goal run (attachedPost null at start) no longer wrongly auto-publishes on a stale/empty snapshot; guardrails compute against the real post. ✅ (matches Phase-02 C1 comments)
- **⚠ GAP — nothing autonomously EXECUTES a granted run.** `grantAutonomy` / `grantAutonomyForCampaign` (`workflow-run-repo.ts:328-357`) only flip `approvalMode='atria'`; the run stays `planned`. Neither grant endpoint calls `launchWorkflow`/`runWorkflow` (grepped `campaigns-router.ts`, `orchestration-router.ts` grant handlers — no launch). The scheduler cron (`cron.ts`→`tick.ts`) only PUBLISHES posts already `status='ready'` (`post-repo.ts:41-52`); it never starts a DAG. The reaper only reaps. **No cron/loop kicks off granted `planned` runs.** So "grant → Atria runs it end-to-end on my behalf" is only half-true: gates auto-clear DURING execution, but a human must still hit `/execute` to START each run. For a materialized campaign this is acute: `createPostForOwner` posts start `status='brief'` (`post-repo.ts:212`); they only reach `ready` via `approveReview` inside DAG execution — which never runs autonomously → granted campaign posts never publish on their own.

### Q3 — Post = instance: does create-post CLONE the flow DAG and run independently? ✅
- `cloneTemplateRun` (`workflow-run-repo.ts:102-132`): finds `kind='template'`, copies frozen `goal`+`plan`, creates a NEW `kind='instance'`, `status='planned'`, `templateId=template.id` run + its own node set. Template itself never executes (`/execute` rejects `kind==='template'`, `orchestration-router.ts:281`).
- Called on post creation when `campaign.flowId` set (`posts-router.ts:64-65`). Materializer takes an equivalent path — per-slot `planWorkflow` → own `createRun`+`createNodes` (`campaign-materializer.ts:79-96`).
- **Good defensive check:** clone re-validates every agentId against the live registry and throws LOUD if a template references a removed agent (`workflow-run-repo.ts:114-117`) — no silently-broken instance.
- Instance runs are excluded from Saved-Flows sidebar (`templateId` filter, `:267-274,:312-320`). Independence confirmed.

### Q4 — Skip-video when platforms/asset-type don't need video? ✅ present, minor stale-snapshot edge
- Gating at `workflow-executor.ts:283-288`: `MEDIA_AGENT_ASSET` (`:49-53`) maps infographic→[image], storyboard→[carousel,video], video→[video]. A media node is SKIPPED (node→`skipped`, no spend) when none of `neededAssets` intersect what it produces. Runs BEFORE the approval halt, so a carousel-only post never even stops at the video gate. ✅
- `neededAssets` = `distinctAssetTypes(attachedPost)` (`:148`, `resolve-input.ts:47-52`) = distinct per-platform asset types across targets. Carousel post → `['carousel']` → `video` agent skipped, `storyboard` runs (serves carousel). Correct, no wasted Veo spend.
- **⚠ edge (low):** `neededAssets` uses the run-START `attachedPost` snapshot (not re-read fresh), and gating only applies when `neededAssets.length>0` (`:284`). For a FRESH-goal run attachedPost is null → `neededAssets=[]` → NO gating → every media node in the plan runs. Not a real waste today because `planWorkflow` composes the plan from `goal.outputs` (a text/image goal never includes the `video` agent), so there is nothing extra to skip. But if a plan ever carried a video node with no attached post, it would run + spend. Acceptable now; note it.

### Q5 — Self-healing reapers for stuck posting/running? ✅ present (but cron OFF by default)
- `reaper.ts:23-84` sweeps every 5 min: posting-stuck posts→`error` (`:27-37`), running-stuck nodes→`failed` with video-aware budget + cascade run→failed (`:41-56`), running-stuck runs→`failed` (`:60-69`), orphaned parked runs past TTL→logged only, never deleted (`:74-78`). Idempotent, state-guarded, per-row failure isolated.
- Detached-executor crash also backstopped: `launchWorkflow` reject → `markRunCrashed` (`orchestration-router.ts:260-273`).
- **⚠ operational:** `ENABLE_REAPER_CRON` defaults `false` (`env.ts:68`); reaper only runs if enabled in `.env` (`server.ts:145`). If not enabled in the demo env, stuck rows are NOT reaped despite the code existing. Verify `.env`.

### Q6 — Per-platform asset validation/review before publish? ✅
- Scheduler `processPost` (`tick.ts:87-103`) builds a per-platform target: checks `platformSupportsAsset` (item 1) + `resolvePlatformInput` (`resolve-input.ts:106-121`, throws `PostValidationError` on missing/mismatched media, carousel<2, non-carousel≠1). Unsupported/missing → recorded as explicit `ok:false` SKIP, not a doomed network call; all-skipped → post `error`.
- Executor gate mirrors it: `buildGuardrailCtx` computes `cleanlyPostable` + `mediaReady` per platform (`workflow-executor.ts:166-176`); human waiver re-checks `cleanlyPostable` (`:336-339`) and KEEPS the gate (surfaces the review) when any target would be skipped.
- Auto-degrade (carousel/video → reuse an existing image for image-only platforms) is deliberate + generates nothing (`resolve-input.ts:32-43`).

---

## Demo-day risks (ranked)
1. **[HIGH] Campaign autonomy grant produces posts that never run/publish autonomously.** After `POST /campaigns/:id/grant-autonomy`, materialized posts sit `status='brief'` + run `planned`; no cron executes them, scheduler only publishes `ready`. Demoing "grant the whole campaign → Atria runs it" will show posts that just sit there until the user manually Executes each. (Q2 gap)
2. **[MED] Reaper cron likely OFF.** `ENABLE_REAPER_CRON` default false. If a demo run wedges (posting/running), it stays stuck — the self-healing story won't fire unless the flag is set. (Q5)
3. **[MED] "Approval gate" auto-waives for clean posts.** A plain FB post publishes with no Approve click (auto-publish default). If the demo narrative is "nothing goes out until you approve," that's contradicted unless `autoPublish:false` is passed. (Q1)
4. **[LOW] Autonomy budget ceiling default $2** (`env.ts:63`). A video-bearing granted run whose est clip cost > $2 will HOLD (park) rather than run autonomously — correct, but may surprise on stage. Campaign ceiling scales ×posts (`campaigns-router.ts:162`).

## Tomorrow fix list
- **P0 — decide + wire autonomous kickoff for granted runs.** Either (a) grant endpoints call `launchWorkflow` for each granted `planned` run after step-2, or (b) add a small "granted-run executor" pass to a cron that picks `approvalMode='atria' AND status='planned'` runs and launches them (respecting connection gate + guardrails). Files: `orchestration-router.ts:337`, `campaigns-router.ts:169`, `workflow-run-repo.ts:344` (add a `findGrantedPlannedRuns` reader), new cron beside `cron.ts`. Without this the campaign-intelligence autonomy story is inert.
- **P1 — confirm `ENABLE_REAPER_CRON=1` (and `ENABLE_SCHEDULER_CRON=1`) in the demo `.env`.** Code is correct; only the flag gates it. `server.ts:144-145`.
- **P2 — skip-video fresh-goal edge:** consider re-reading the post fresh for `neededAssets` (like the guardrail ctx already does) so gating still applies on runs where the post is created mid-flow. `workflow-executor.ts:148`. Low priority (plan composition already prevents real waste).

## Unresolved questions
- Is the "no autonomous kickoff" a deliberate scoping decision (grant = remove gates only; human still starts the run) or an unfinished Phase-05 wire? The Phase-01 policy header says the flow "executes its whole flow with no mid-flow approval gate" — implies it should also START, but no launcher exists. Needs product confirmation.
- Does the demo `.env` actually enable the reaper + scheduler crons? Not verifiable from source (gitignored). Memory notes scheduler+leads enabled; reaper unknown.
- For a granted run that IS manually executed, does the UI expose per-post "held at gate" state from `atriaHold`'s notify so the user knows to intervene? Out of this domain's scope (UI); flag for domain-A/UI audit.

---
Status: DONE
Summary: The approval gate, per-platform validation, template→instance cloning, asset-type video-skip, and self-healing reapers are all genuinely implemented and the autonomy grant seam (HMAC double-confirm + fail-closed policy + park-on-hold) is real and byte-safe — the prior stale-attachedPost auto-publish bug is fixed via fresh post re-reads. The one material gap: granting autonomy (run or campaign) never AUTONOMOUSLY starts the DAG — granted runs stay `planned` and no cron executes them, so "Atria runs the whole campaign on my behalf" currently requires a human to click Execute per post.
