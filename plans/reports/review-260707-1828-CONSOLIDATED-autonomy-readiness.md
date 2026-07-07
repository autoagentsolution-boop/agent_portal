# Consolidated Review — Autonomy Readiness (2026-07-07)

5 read-only reviewers (execution core, state-machine QA, consistency, workflow/registry, connect/credential). Deduped + severity-ranked. Individual reports: `review-260707-1518-*.md`, `review-260707-1828-*.md`.

**Framing question (BLOCKS everything, both A + E raised it):** does Atria's autonomous loop call `POST /runs/:id/execute` (gated path) or `runWorkflow`/scheduler directly (ungated)? Decides whether half the gate-bypass findings are theoretical or the default path. **Answer this first.**

---

## CRITICAL — autonomy-blocking (each confirmed by ≥2 reviewers)

| # | Finding | Where | Fix direction |
|---|---------|-------|---------------|
| C1 | **Fresh-goal runs never auto-publish / never media-gate.** `attachedPost` snapshotted ONCE at run start; on a fresh goal the post is created mid-run → `attachedPost=null` whole run → `cleanlyPostable=false` → publisher always parks for a human, media gating off. "Atria goal→publish" silently dead-ends. (A#2, D#2, B) | workflow-executor.ts:126,249 | Re-read the post at the publisher boundary, not the stale snapshot |
| C2 | **Scheduler cron = ungated 2nd publish path.** (a) bypasses publisher gate — `hasActiveFlowNodes` ignores `awaiting_approval`, so a `ready`+scheduled post parked at a gate is published before media exists → silent error + orphaned run. (b) publishes via `publishTo` directly, NOT `runtimePublishFn`/`invokeAction` → no kill-switch, no audit, no idempotency, no rate-limit. (A#1, B#3, E#1) | tick.ts:204, workflow-run-repo.ts:139 | Treat parked publisher as not-due; route scheduler through connector runtime |
| C3 | **No reapers for stuck states.** post `posting` (crash post-claim → never re-picked, not editable/deletable), run `running` (detached crash, `void…catch` swallows error → Atria gets HTTP 200 but wedged), node `running` (blocks scheduler forever — the 321f253c class). Zero auto-recovery; fatal across redeploys. (A#3, B#1, B#2) | post-repo.ts:59, executor:143, tick.ts | Timeout reapers: posting→error, stale run→failed, stale node→failed |
| C4 | **Gates assume a human; no autonomous-approval hook.** concept + publisher gates resume only via UI `approve-node`; clarification emits required Qs with no machine bypass; **video double-gates (autoPublish=false + hard cost gate) with NO override → Atria cannot autonomously publish video** (the branch's whole pivot). (A#4, D#3, D#4) | workflow-executor.ts:113,253, clarification-engine.ts | Autonomous-approval path + conceptGate/autoPublish/clarification override flags |

## HIGH

| # | Finding | Where | Fix |
|---|---------|-------|-----|
| H1 | **Silent false-success on publish.** (a) `approveReview` no-op but node marks completed → nothing publishes; (b) `runPublisher` maps not_publishable/not_found to artifact w/o throwing; (c) X adapter degrades image→text on 403, returns ok:true. Atria reads "completed", moves on. (A#5, B#5, E#3) | agent-runners.ts:275-281, workflow-executor.ts:199 | Propagate real publish failure to node/run status |
| H2 | **rerun-node on a `posted` post → double-publishes LIVE.** downstream reset to pending incl. publisher, but post not reset from `posted`; Continue reaches pending publisher → republish. (B#4) | orchestration-router.ts:313 | Guard publisher vs already-posted / reset post on downstream rerun |
| H3 | **Carousel publisher missing DAG edge on storyboard** → can publish blank carousel once execution isn't strictly serial. (D#1) | agent-registry.ts:150 | Add storyboard→publisher input for carousel |
| H4 | **Connection gate runs once at /execute; resume + scheduler never re-resolve.** Token expiring between gate and actual publish voids the "$0 gate". (E#2) | connection-resolver, executor waiver | Re-resolve connections at publisher boundary |
| H5 | **Pre-DAG gate over-trusts unverified pasted tokens** — resolver says `active`, connection-state says `needs_attention` (disagree) → spends full budget on possibly-dead token. (E#4) | connection-resolver.ts vs connection-state.ts | Reconcile; require liveness verify before gate passes |
| H6 | **[MY BATCH-3 BUG] DAG node credit badge undercounts storyboard >10×** — ternary takes token branch when plan-tokens present, drops the flat frame USD that's in node.costUsd; badge disagrees with Usage. Only on flat-image fallback. (C#1) | run-dag-view.tsx:57 | Make badge additive (token-credits + usd-credits), mirror backend |

## MEDIUM

| # | Finding | Where |
|---|---------|-------|
| M1 | Language fallback diverges: copy→'vi', media/ideation `resolveRunLanguage`→'en'; legacy no-post runs mismatch. (C#4) | agent-runners.ts:309,511 |
| M2 | **[MY CODE] Leads sweep misses URL-less watched sources** — checkPostLinks iterates postUrls only; X (no postUrls) never existence-checked → never self-heals. (C#2) | post-liveness.ts:27 |
| M3 | **[MY CODE] Per-tick liveness sweep ~2× API, redundant** with PostGoneError; re-checks dead URLs each tick. (C#3) | comment-cron.ts |
| M4 | Identity-id env fallback (`MKT_FB_PAGE_ID`/`MKT_IG_USER_ID`) → autonomous post could land on SYSTEM-default account. (E#5) | facebook.ts, instagram.ts |
| M5 | `getActiveToken` uses needs_attention/expired (only excludes revoked); gate reads goal.platforms but publish uses post.platforms; ENABLE_TOKEN_CRON default OFF → stale liveness + LinkedIn silent ~60d expiry; tokens in URL query params. (E) | social/*, connection layer |
| M6 | `SPENDING_AGENTS` stale + dead code (omits live content_search, 0 imports); concept_writer.requiresApproval=false served to UI but parks needs_approval (display≠behavior). (D#5) | node-cost.ts:113 |
| M7 | `partial` status dead-end (no per-platform retry); orphaned needs_approval/planned never expire; concept re-run silently posted→brief; publish-only goals dead-end plan_error; cloneTemplateRun no registry re-validation → dropped agent breaks templates; lead_collector shown "coming soon" but live. (B, D) | multiple |

## LOW
- Credit anchors 250/0.000625 hardcoded in frontend vs shared constants ([MY CODE], run-dag-view.tsx:57) — equal today, desync risk.
- Roster display-vs-runnable mismatches (command-center vision agents).

---

## Themes for the UI-v2 / Atria-autonomy build
1. There is **no machine-approval seam** — every gate is a UI halt. Autonomy needs a first-class "who approves" concept (Atria policy) wired into concept/publisher/video/clarification gates.
2. The **scheduler is a shadow publish path** that ignores gates + the §11 safety layer. Either retire it for autonomous flows or route it through the runtime.
3. **No self-healing** — stuck states need human rescue today. An always-on fleet needs reapers + real failure propagation (no silent ok:true).
4. `attachedPost` staleness makes the primary (fresh-goal) path the LEAST autonomy-ready.

## Quick wins I can fix now (my own recent regressions)
H6 (badge undercount), M2 (sweep union), M3 (sweep throttle), LOW (shared anchors), M1 (language fallback).

## Unresolved questions
- Atria loop: gated `/execute` vs ungated `runWorkflow`/scheduler? (decides C2/H4 severity)
- Who owns the publish decision for scheduled posts — in-flow gate or cron? (they currently race)
- Is the scheduler cron ON in the target deploy? (gates whether C2 is live)
