# Phase 04 — UI adaptation (can the current web adapt to command-center v2?)

**Answer: yes, adapt — do NOT rebuild.** The Atria command-center v2 mockup is an evolution of the
existing Orchestrate + Flows web app, not a different application. Same React/Vite/TS, same API.

## What the mockup shows (extracted from atria-command-center-v2.html)
- Sidebar with **Credit balance** (◈ Credit: 1,240) + "Command Center".
- A central **"Neural Network"** view grouping agents: Nhóm Trí tuệ / Hành động / Trợ lý
  (Intelligence / Action / Assistant).
- Orchestration flow with the **2 checkpoints** (confirm tasks, approve plan) — already exists.
- **Multi-tier plan cards** (Tiết kiệm/Cân bằng/Đầy đủ) with agent count + token + credit.
- Leads task ("Thu thập leads — chỉ opt-in").

## Reuse vs new (current web)

| Mockup piece | Current component | Verdict |
|---|---|---|
| 3-stage orchestrate flow | `OrchestratePanel` + `run-dag-view` + PlanCard | **Reuse** — already this shape |
| 2 checkpoints | clarify gate + publisher approval | **Reuse** |
| Per-node cost/tokens | `run-dag-view` NodeStats (my #5) | **Reuse** — feeds credit display |
| Sidebar sections | App sidebar (New chat / Connections / 📚 / Flows) | **Extend** — add groupings + Leads |
| Multi-tier plan cards | PlanCard (single) | **New variant selector** on existing card |
| Credit balance | none | **New** — small header widget + ledger read |
| Leads page | none | **New** — Phase 01 gap 3 |
| "Neural Network" agent map | AgentCatalogPreview (static) | **Optional restyle** — cosmetic, low priority |

## Effort read
- **Low:** sidebar groupings, credit widget, Leads page (mirrors the 📚 page I just built).
- **Medium:** multi-tier plan card selector (needs Phase 03 planner variants behind it).
- **Cosmetic/optional:** the "Neural Network" visual — nice for demo, not functional; defer.

## Recommendation
- Adapt incrementally on the SAME web app; no rewrite, no second frontend.
- Order UI work to follow its backend: Leads page after Phase 01; plan-tier cards after Phase 03
  planner variants; credit widget after the ledger exists. Building UI ahead of its API = the same
  "local state that looks done but isn't persisted" trap we just fixed for product knowledge.
- The command-center "look" (dark neural theme) is a theming pass over existing components —
  schedule last, once flows are functionally complete, so restyle churn doesn't fight feature work.

## Success criteria
Every mockup panel maps to a real, API-backed component (no decorative-only surfaces that imply
data they don't have); the existing Orchestrate/Flows behavior is preserved through the restyle.
