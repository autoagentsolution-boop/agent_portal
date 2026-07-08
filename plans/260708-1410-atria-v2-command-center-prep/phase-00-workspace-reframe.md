# P0 — Workspace reframe (thin / hybrid)

**Priority:** P0 (unblocks the v2 UI shape) · **Status:** planned · **Depth:** presentation + IA only,
NO deep model rip-out (that's the post-UI 2nd beat per decision 1).

## Key insight
The image's "Workspace" = a campaign room where a GROUP of agents work, each with live activity +
output + per-agent cost + controls. ALL that data already exists: `WorkflowRun` + `WorkflowNodeRun`
(per-agent status/timeline), artifacts (output), `mkt_llm_usage` (per-agent cost), SSE (live). So a
Workspace is a NEW VIEW-MODEL over Campaign + its runs — not a new engine. Keep the DAG.

Also retire the v1 test-scaffold confusion surfaced today:
- "Run a test post" 409 (already patched in b31ff4d via `/runs/:id/test-run`).
- Flow-template → Campaign → Post → instance-run tiering + "Ungrouped campaigns" reads as debug UI.

## Files (read → change)
- `web/src/App.tsx` (Flows tree + `page` IA), `web/src/components/ActiveFlowsPage.tsx`,
  `campaign-command-view.tsx`, `post-workflow-view.tsx` — the surfaces to reframe.
- `src/db/repos/workflow-run-repo.ts` (`campaignStatusRollup`, `getFlowCostRollup`),
  `src/orchestration/master/campaign-grant.ts` (`campaignStatusRollup` DerivedPostStatus) — the
  rollup that already aggregates per-post/per-agent state for a "workspace dashboard".

## Steps
1. Define a `Workspace` view-model (backend read-only): campaign + its posts/runs + per-agent rollup
   (status, tokens, cost) + latest outputs. Reuse `campaignStatusRollup` + cost rollup; add per-AGENT
   (not per-post) aggregation for the dashboard's "cost by agent" (Researcher 42 / Editor 38…).
2. Add `GET /workspaces` + `GET /workspaces/:campaignId` DTOs (thin wrappers over existing repos).
3. IA rename Flows → Workspaces in the sidebar; collapse the template/instance jargon into one
   "Workspace → Posts" tree. Keep template-as-blueprint under the hood; hide the seam from the user.
4. Keep `/runs/:id/test-run` as the canonical "run this workspace" action.

## Todo
- [x] Workspace view-model + per-agent rollup (backend, read-only over existing tables) — `campaignAgentRollup` (workflow-run-repo) + `workspace-view.ts` (listWorkspaces/getWorkspace)
- [x] `GET /workspaces[/:id]` + DTOs — `workspaces-router.ts` mounted; client `listWorkspaces`/`getWorkspace` + `WorkspaceSummaryDto`/`WorkspaceDetailDto`
- [~] Sidebar IA Flows→Workspaces — vocabulary nudge landed (▦ Workspaces, drop "Ungrouped"). **Structural tree-collapse (flat Workspace→Posts, hide flow-blueprint tier) DEFERRED to P1** — P1 rebuilds the Command Center as the hub w/ inline workspace panels; collapsing the sidebar now = throwaway + inconsistent interim UI (decision 1: thin/hybrid, don't double-build).
- [x] tsc (backend + web) + verify green — new `verify-workspace-view.ts` PASS; regression: verify-campaign-grant + verify-flow-cost-rollup PASS

## Status: DONE (backend view-model + endpoints + client wiring + vocab). Structural sidebar collapse folded into P1.

## Success criteria
- One "Workspace" concept in the UI = a campaign room; no user-facing template/instance/"Ungrouped".
- The per-agent dashboard numbers (cost/tokens/status by agent) come from real ledger data.

## Risk
- LOW — additive read-model. Don't touch the executor/run engine (deep refactor is the 2nd beat).
