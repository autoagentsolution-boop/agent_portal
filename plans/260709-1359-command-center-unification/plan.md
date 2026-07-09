# Command Center Unification — UI/UX Re-architecture

Branch: `pivot/video-content-farm` · Started 2026-07-09 · Scope: MKTAgent/web (frontend-only)

Make the Command Center the single home: top navigation (no left sidebar), Atria chat merged INTO
the Command Center surface (dark neural style wins), and a "living" feel — typewriter token effect +
thinking animation + agent nodes lighting up. Voice = future seam only.

## Locked decisions
- **Streaming = VISUAL ONLY** — client-side typewriter + thinking animation. NO `generateContentStream`,
  no backend/cost change. (User clarified.)
- **Merge/layout** — EMBED OrchestratePanel (restyle dark) into CC. Idle = full neural graph + command
  bar. Chat open = graph shrinks to a mini-hero (nodes light when active), transcript below, command bar.
- **IA** — remove the left sidebar entirely. All nav → top bar. Chats + Workspaces via panels/dropdowns.

## Risks (live)
- R2 regression: reuse OrchestratePanel, don't rebuild. R3 layout tension: graph→mini-hero on chat.
- R4: node "activity" is data-driven only during RUNS (SSE node events); pure chat reply = decorative pulse.
- R5/R7: gutting the sidebar relocates EVERY nav item (incl. Product Knowledge/Leads/Workspaces-tree/Chats).

## Phases
- [x] **P1 — Shell: top nav + remove left sidebar.** DONE + browser-verified (top nav renders, Chats ▾
  dropdown works, routing works, no overflow). `top-nav.tsx` + `app-nav.ts` new; sidebar removed; CC lost
  its own topbar (global nav owns credits/Workspace); orphaned tree handlers removed. New `TopNav` (global): brand · tools group
  (Instructions/Impact/Connections/Usage/Scheduled/Product Knowledge/Leads) · Workspace ▾ (move existing) ·
  Chats ▾ (history+delete+search) · credits · theme · user. Delete `.app-sidebar`. Keep `page` routing +
  all handlers. Verify every page still reachable. Commit.
- [ ] **P2 — Merge Atria into Command Center.** CC hosts the chat: embed OrchestratePanel (dark restyle),
  command bar drives chat inline (no page switch); graph → mini-hero when a session is active; retire the
  standalone `Atria` nav + `page:'orchestrate'` (or make it an alias of command-center). Preserve run cards,
  restore, suggestion/resume-work cards, connection gate, SSE multiplex.
- [ ] **P3 — "Alive" animation.** Typewriter token reveal on Atria replies + thinking state; node
  light-up (SSE-driven during runs, decorative pulse during chat); resume-work/suggestion cards surface
  in CC. Design the reveal as a stream seam so voice/TTS can subscribe later.
- [ ] **P4 (future)** — voice sync. Deferred; only keep the P3 reveal seam compatible.

## Success criteria
- No left sidebar; every prior nav destination reachable from the top bar. No regressions in chat/run flow.
- CC is the landing + chat host; dark neural style throughout; typewriter + thinking feel present.
- Browser-verified each phase; typecheck green; committed per phase.
