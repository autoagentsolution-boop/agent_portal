# Atria v2 — Command-Center System (pre-UI/UX re-architecture)

**Vision (user, 2026-07-08):** v1 = a workflow + navigation to test features. v2 = a real SYSTEM at
Atria's UX standard: **Command Center** as the orchestration hub — Atria (conductor) at the centre,
agents as nodes grouped by division (Trí tuệ / Hành động / Trợ lý). Click a node → a **Workspace**
(today's "Flows") = a group-of-agents workroom showing each agent's live activity, output, per-agent
cost, and controls (re-run / edit / assign-more). Plus: **vision agents become real**, and a BIG one —
**Atria converses by voice**, not just text.

This plan is the PRE-v2 conversion layer (model + agents + capability wiring) that the UI/UX v2 build
sits on. It is NOT the v2 UI itself.

## What already exists (the scaffold — don't rebuild)
- **Command Center** neural-network page (`command-center-page.tsx`) — nodes + credit badge; today it
  FUNNELS into the Orchestrate chat rather than hosting workspaces inline.
- **Division taxonomy** (`agent-groups.ts`) — intelligence/action/assistant = Trí tuệ/Hành động/Trợ lý.
- **9 runnable agents** (registry) + **4 vision agents** (`vision-agents.ts`: memory, lead_collector,
  analytics, email) that render as display-only nodes (no runner).
- **Run/Node/Artifact/Cost** engine — the real per-agent activity, output, and token/credit data the
  Workspace panel needs already flows through this (DAG executor + `mkt_llm_usage` ledger + SSE).
- **Flows** tree (Flow-template → Campaign → Post → instance-run).

## Target → the image
- Command Center = the operating surface (not a redirect). Node → inline **Workspace** panel.
- Workspace = a campaign room: agent tabs (Researcher/Editor/Design…), each agent's live timeline +
  OUTPUT + re-run/edit/assign, and a per-workspace dashboard (progress, tokens, cost-by-agent).
- Vision agents runnable. Atria voice I/O.

## Current → target mapping (the conversions)
| Area | v1 now | v2 target | Effort |
|---|---|---|---|
| Home | Chat home + CC funnel | Command Center hub, node→workspace inline | M |
| Flows | DAG tree (template/campaign/post) | **Workspace** (agent-room presentation over the same run data) | M–L |
| Agents | 9 real + 4 display-only | vision agents → real (runner + integration) | L |
| Atria I/O | text chat | text **+ voice** (STT in, TTS out, conversational) | L (new) |
| Data model | Flow/Campaign/Post/Run | thin **Workspace** abstraction over existing entities (rename/reframe, not rip-out) | S–M |

## DECISION GATE — RESOLVED 2026-07-08 (user)
1. **Model depth = HYBRID:** thin Workspace presentation layer over the existing run/DAG engine NOW
   (fast to v2 UI, low-risk); deep model refactor (Workspace/GroupAgent first-class) AFTER the UI
   stabilises — 2 beats.
2. **Vision agents = ALL FOUR real** (Memory → Analytics → Email → Lead Collector), sequenced Memory
   first. Other/future vision AIs stay display-only "planning / coming-up" nodes.
3. **Voice = SPEC + defer build.** Design the flow + pick tech in this plan; build during v2 proper.
4. **Auth = DEFER (keep Google-only).** Deliberate: reuse the Google login to leverage **Google Drive
   for media storage** instead of building S3 now — Drive public URLs also unblock IG/Threads/LinkedIn
   image publish (the local-asset-URL blocker). SSO later if user traction is good.

## Phases (build order)
- [x] **P0 — Workspace reframe (thin/hybrid)** · [phase-00](phase-00-workspace-reframe.md) — DONE:
  backend view-model over Campaign+runs (`campaignAgentRollup` + `workspace-view.ts`) + `GET /workspaces[/:id]`
  + client wiring + vocab nudge (Flows→Workspaces, drop "Ungrouped"). Structural sidebar collapse folded
  into P1 (avoid double-build). No deep model rip-out (that's the post-UI 2nd beat).
- [x] **P1 — Command Center as hub** · [phase-01](phase-01-command-center-hub.md) — DONE: node → inline
  drawer (WorkspacePanel dashboard+posts / AgentSpotlight), NOT a redirect; post drill reuses
  PostWorkflowView (re-run/edit/publish); CC is default landing; SSE multiplex + poll. Build green,
  not yet browser-driven.
- [ ] **P2 — Vision agents → real** · [phase-02](phase-02-vision-agents-real.md) — Memory first
  (learn-style, builds on instruction system), then Analytics, Email, Lead Collector.
- [ ] **P3 — Media storage via Google Drive** · [phase-03](phase-03-media-drive-storage.md) — publish
  media from Drive public URLs → unblock IG/Threads/LinkedIn image publish, no S3. Leans on the kept
  Google auth.
- [ ] **P4 — Voice (SPEC only)** · [phase-04](phase-04-voice-spec.md) — design STT-in/TTS-out
  conversational Atria + tech choice; build deferred to v2 proper.
- [ ] **P5 — Cleanup** · [phase-05](phase-05-cleanup.md) — refine chained-rerun robustness; X/LI/Threads
  text live-verify on real accounts.

**Sequencing:** P0 + P1 first (unblock the v2 UI shape), then P2/P3 land in parallel while UI v2 iterates;
P4 is spec now/build in v2; P5 opportunistic. Auth dev-login deferred (see decision 4).

## Not in scope here
The v2 visual design system / component library (that's the UI/UX v2 build this plan precedes); the deep
first-class Workspace model refactor (post-UI 2nd beat); voice BUILD; SSO.
