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
- [ ] Fix chained rerun-while-parked (deterministic or guarded)
- [ ] 1 controlled real text post each: X, LinkedIn, Threads
- [ ] Fold Scheduled + text-only into the v2 Workspace/Command-Center IA

## Success criteria
- Rerun sequences from a parked run behave predictably (no stuck `pending`).
- X/LI/Threads text confirmed live (once each), no bursts.

## Risk
- LOW. The real-post checks touch live social — one each, spaced (Meta 24–48h burst ban).
