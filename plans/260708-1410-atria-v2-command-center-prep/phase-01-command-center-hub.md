# P1 — Command Center as the hub (node → inline Workspace)

**Priority:** P0 (with P0) · **Status:** planned · Depends on P0's Workspace view-model.

## Key insight
`command-center-page.tsx` already renders the neural-network (Atria centre + agent nodes grouped by
`agent-groups.ts` divisions + credit badge). Today `onLaunch` REDIRECTS into the Orchestrate chat.
v2 target (the image): the Command Center IS the operating surface — clicking a node opens an inline
panel, not a redirect. Two node kinds:
- **Agent node** (Researcher, Strategist, Publisher…) → the agent's live state across active workspaces
  (what it's doing now, recent outputs, cost).
- **Atria centre** → the conductor chat (text now, + voice later) that spawns/assigns work.
- **Workspace context** → the image's right panel: a selected campaign's agent tabs + activity + output
  + dashboard (from P0's view-model).

## Files
- `web/src/components/command-center-page.tsx` (the canvas + `onLaunch`), `agent-groups.ts` +
  registry (node data), the new `GET /workspaces` (P0), `use-post-events`/SSE (live activity),
  `campaign-grant.ts` rollup (dashboard).

## Steps
1. Replace `onLaunch`-redirect with an inline right-panel router: node click → agent detail OR workspace
   panel (the image's layout) rendered IN the Command Center, not a page jump.
2. Workspace panel = P0 view-model: agent tabs, per-agent live timeline (SSE), OUTPUT block, and the
   right-rail dashboard (progress %, tokens, cost-by-agent, workspace total).
3. Controls per agent: Re-run (`/runs/:id/rerun-node/:nodeId`), Edit (edit-copy/refine), Assign-more
   (add a step / new post) — wired to existing endpoints.
4. Atria centre → conversational panel (text) that can target a workspace; voice slot reserved (P4).
5. Keep the current chat page reachable, but Command Center becomes the default home.

## Todo
- [x] Inline panel router in Command Center (no redirect) — `panel` state + `.cc-drawer` (scrim + slide-in); agent node → AgentSpotlight, workspace chip → WorkspacePanel. Atria core + cmd bar still onLaunch (chat).
- [x] Workspace panel over P0 view-model — `workspace-panel.tsx`: dashboard (status counts + cost-by-agent cards) + posts list; live via `use-workspace-events.ts` (SSE multiplex over the workspace's runIds → debounced refetch) + 10s poll fallback.
- [x] Per-agent controls wired to existing endpoints — post drill embeds the existing `PostWorkflowView` (re-run node / edit-copy / refine / publish gate all reused, NOT re-implemented).
- [x] Command Center as default landing — App.tsx default `page='command-center'`; ⌂ Workspace + sidebar still reach classic UI + chat.
- [x] Agent spotlight — `agent-spotlight.tsx`: an agent's activity across ALL workspaces (client-side compose over listWorkspaces→getWorkspace; capped fan-out).

## Status: DONE + LIVE-VERIFIED (2026-07-08, browser-driven via agent-browser on real account, 18 workspaces).
Confirmed live: CC default landing renders (13 nodes + core + 18 workspace-strip chips w/ real status dots);
workspace chip → inline drawer with dashboard (7 cost-by-agent cards: Concept 38cr / Storyboard 35cr /
Ideation 26cr / Strategy 24cr…, status "Needs you 1 / Posted 5", 6 posts); post drill → embedded
PostWorkflowView (full 7-step DAG, per-node runtime+credits, re-run/edit/publish, "view post ↗"); agent
node → spotlight ("💡 Ideation, Active in 1 workspace · 6 runs" — cross-checked accurate vs DB). Light
drawer over dark CC = no theme bleed. Build green (web tsc -b + vite build; backend tsc).

## Success criteria
- Clicking a node opens its workspace/agent detail INLINE (matches the image), live-updating via SSE.
- Re-run / edit / assign work from the panel without leaving the Command Center.

## Risk
- MEDIUM — mostly frontend re-composition over existing data/endpoints; watch SSE subscription churn
  (useCallback-stable props — see [[feedback_react_callback_prop_stable]]).
