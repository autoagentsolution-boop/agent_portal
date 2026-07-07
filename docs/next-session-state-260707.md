# Next-session state — 2026-07-07

Branch `pivot/video-content-farm`. Repo https://github.com/autoagentsolution-boop/agent_portal (private).
Work of this session is **NOT committed yet** (user reviewing / in a meeting).

## ⚠ DO THIS FIRST
1. `prisma generate` was re-run this session — the generated client was stale vs the committed
   `platform_post_ids` migration (94b1a02), which surfaced as false `platformPostIds` tsc errors in
   `comment-watch.ts` / `post-liveness.ts` / `scheduler/aggregate.ts`. After generate → tsc clean.
   If those errors reappear on a fresh checkout, run `npx prisma generate` in `MKTAgent/`.
2. Web = **vite dev :5173** (`npm run dev` in `web/`), backend = container :7100. To see the new
   Command Center: start both, sign in, click **◈ Command Center** in the sidebar.
3. `.env` crons still enabled from 2026-07-06 (gitignored): `ENABLE_SCHEDULER_CRON`,
   `ENABLE_LEADS_CRON`, `ENABLE_TOKEN_CRON`. Scheduler publishes REAL posts every minute.

## What shipped today (uncommitted, in working tree)
**Atria Phase 04 — Command Center page** (additive, page-scoped):
- `web/src/components/command-center-page.tsx` (NEW) — neural-network landing: Atria core + agent
  nodes on an ellipse coloured by division, live credit badge, command bar with quick commands.
- Funnel design: node/core/command-bar → redirect into existing Orchestrate (`onLaunch`, optional
  prefill); `⌂ Workspace` → Flows. Does NOT re-implement orchestrate/workspace.
- `GET /orchestration/agents` (orchestration-router) — registry as display data (groups + nodes).
- `web/src/api/client.ts` — `AgentCatalog`/`AgentNodeDto` types + `getAgents()`.
- `OrchestratePanel` — optional `initialInput` prop (carry the typed command into a fresh composer).
- `App.tsx` — `◈ Command Center` sidebar item + `command-center` page + prefill state.
- `web/src/styles.css` — `.command-center` scoped dark CSS (dark confined to the page; safe/reversible).

**Vision agents wired as display-only roster** (command-center only, NOT runnable):
- `src/orchestration/registry/vision-agents.ts` (NEW) — Memory / Lead Collector / Analytics / Email
  as `implStatus:'planned'` display nodes. NOT in `AGENTS`, NOT in `RunnableAgentId` → zero DAG /
  planner / executor / type impact. Endpoint appends them; the page renders them dimmed + non-clickable
  ("coming soon" notify) so nothing implies they run.

**Phase 05-B — agency-agents prompt mining** (subagent, DONE):
- Enriched all 8 runnable agents' persona fields from 7 MIT personas; `promptSections` for
  concept_writer + publisher. Attribution `docs/agency-agents-attribution.md`. 0 schema/id/DAG changes.

## Verify done / deferred
- Done: backend + web `tsc --noEmit` green; `vite build` green; `/orchestration/agents` payload real
  (8 runnable nodes + 4 planned, 3 groups).
- Deferred: live browser screenshot (stack not running this session).

## Next
- Commit + push (awaiting user OK).
- Optional: dark theme as a GLOBAL pass — only after core flows complete (promote `--cc-*` to global).
  Deliberately deferred; the page-scoped version is the safe interim.
- Phase 05-C UI: group agents in the sidebar too (currently only the command-center groups them).
- Live-untested comment fetchers (Threads/LinkedIn/X); IG/Threads liveness still `null`.
- Pre-existing red unrelated to this work: verify-master empty-plan guard (2).
