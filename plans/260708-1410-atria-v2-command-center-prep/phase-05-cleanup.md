# P5 — Cleanup (carried from today's drive-test)

**Priority:** P2 · **Status:** planned · Opportunistic — do alongside P0–P3.

## Items
1. **Refine chained-rerun robustness** — refine copy works; a single-node rerun works; but chaining
   concept-rerun → infographic-rerun WHILE the run is parked at the publisher gate was flaky (concept
   node went `failed`, infographic stuck `pending`). Root-cause the rerun-node state machine when the
   run is at `needs_approval`, and make the sequence deterministic (or block/queue it clearly).
   - Files: `orchestration-router.ts` (`/rerun-node`), `workflow-executor.ts` (rerunOnly path),
     `workflow-run-repo.ts` (node reset/collectDownstream).
2. **X / LinkedIn / Threads text — live-verify on real accounts** — the text branches are code-verified
   (DRY, mocked fetch, all green) + FB live-tested. Do ONE controlled real text post per platform to
   confirm the live API path (endpoints/scopes), honoring the no-burst rule.
   - Files: `src/social/{x,linkedin,threads}.ts` text branches (already implemented).
3. **Doc/UX polish** — "Ungrouped campaigns" wording (subsumed by P0 Workspace reframe); ensure the
   Scheduled view (b31ff4d) and text-only publish (413fef0) are surfaced in the v2 IA.

## Todo
- [x] **Fix chained rerun-while-parked — DONE + verified (2026-07-08).** ROOT CAUSE = TOCTOU race in
  `/rerun-node`: it read run status, checked `!== running`, then did an UNCONDITIONAL `setRunStatus('running')`
  + fire-and-forget `launchWorkflow`. Two rapid reruns (or rerun racing resume/approve) both passed the check
  → both launched detached executors → overlapping node writes corrupted state (the "concept failed +
  infographic stuck pending"). FIX: atomic claim via `transitionRun(id, owner, full.status, 'running')` BEFORE
  resetting nodes — only ONE caller wins the move to running; loser gets 409 `run_in_flight`, mutates nothing.
  Also: re-running a `pending`/`awaiting_approval` downstream node now returns a guiding 409 (`node_not_run_yet`
  → "click Continue") instead of a generic refusal. verify-rerun-race PASS; verify-rerun-node still PASS.
- [~] 1 controlled real text post each: X, LinkedIn, Threads — **USER-TRIGGERED** (outward-facing + Meta 24-48h
  burst-ban risk [[feedback_no_burst_social_posts]]; text branches are code-verified DRY). Not done by agent.
- [x] Scheduled + text-only in v2 IA — **already surfaced**: ◷ Scheduled is in the sidebar; text-only publish
  (413fef0) works via the publish path; "Ungrouped" jargon removed in P0 vocab nudge. A dedicated CC Scheduled
  surface is optional (YAGNI — reachable today); not built.

## Status: DONE (the real code item — rerun race — fixed + verified). #2 is a user-triggered live-social check.

## Success criteria
- Rerun sequences from a parked run behave predictably (no stuck `pending`).
- X/LI/Threads text confirmed live (once each), no bursts.

## Risk
- LOW. The real-post checks touch live social — one each, spaced (Meta 24–48h burst ban).
