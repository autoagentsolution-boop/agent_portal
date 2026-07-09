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

  **P2 is the highest-risk phase (R2). Rule: EMBED, don't rewrite. Each sub-step keeps the app green
  (typecheck + browser) and is a SEPARATE commit; the old `page:'orchestrate'` chat stays fully working
  until the very last step, so no capability is ever lost mid-refactor. Any step reverts on its own.**
  - [ ] **P2.0 — Surface Atria suggestions on the CC landing.** Render `AtriaSuggestionCards` +
    `AtriaResumeWorkCards` on the CC idle view (near the command bar), reusing the components as-is
    (they self-fetch). FIXES the misplacement (they only showed inside an empty chat). Decoupled from the
    merge → ship first, ~zero risk. Verify cards appear + "plan campaign"/"resume" actions still work.
  - [ ] **P2.1 — CC can HOST the chat (additive).** Add an in-CC dark chat container that mounts the SAME
    `OrchestratePanel` (same props App already wires: restore/prefill/onRunActivity/…). Keep
    `page:'orchestrate'` intact as fallback. No logic change — a second mount point. Verify a chat renders
    inside CC (run cards, restore, connection gate, SSE all still work because it's the same component).
  - [ ] **P2.2 — Command bar + Atria core drive the in-CC chat.** Change CC `onLaunch` to open the in-CC
    chat instead of switching pages; graph shrinks to a mini-hero (CSS state). Verify send → reply in CC.
  - [ ] **P2.3 — Chats ▾ + continue-chat open in-CC.** Point `selectChat` at the in-CC host (was
    `page:'orchestrate'`). Verify restoring a past chat lands in CC with its run card.
  - [ ] **P2.4 — Dark restyle of the embedded chat.** Add a `variant="dark"` class path on OrchestratePanel
    so the transcript/bubbles/composer match the CC skin. CSS/class only, no logic. Verify visuals.
  - [ ] **P2.5 — Retire the standalone path (last, only after 2.1–2.4 proven).** Remove the
    `page:'orchestrate'` branch + `openOrchestrate`; make any remaining callers use the in-CC host. Separate
    commit → trivially revertible. Verify nothing routes to a dead page.

  - [ ] **P2.6 — Unify the "workspace" concept (IA decision: LOCKED = merge).** ONE workspace concept:
    remove the "Workspaces" nav item (drop `flows` from TopNav NAV). The **Workspace ▾ dropdown → dashboard
    drawer (WorkspacePanel)** is the single entry. Add an **"Mở board đầy đủ / Open full board"** button
    inside the drawer that navigates to the deep board (`page:'flows'` + `activeCampaign`=that campaign =
    PostBoard + DAG). `ActiveFlowsPage` stays as the deep board, just reached from the drawer instead of a
    top-nav item. Verify: dropdown → dashboard → open board → back.
- [ ] **P3 — "Alive" animation.** Typewriter token reveal on Atria replies + thinking state (VISUAL only —
  no `generateContentStream`); node light-up (SSE-driven during runs, decorative pulse during chat).
  Design the reveal as a stream seam so voice/TTS can subscribe later.
- [ ] **P4 (future)** — voice sync. Deferred; only keep the P3 reveal seam compatible.

## Success criteria
- No left sidebar; every prior nav destination reachable from the top bar. No regressions in chat/run flow.
- CC is the landing + chat host; dark neural style throughout; typewriter + thinking feel present.
- Browser-verified each phase; typecheck green; committed per phase.
