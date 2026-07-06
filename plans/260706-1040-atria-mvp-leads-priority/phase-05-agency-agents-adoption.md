# Phase 05 — Adopt from `msitarzewski/agency-agents` (v2 agent layer, NOT orchestration)

**Priority:** P2 — part of the v2 refactor AFTER Lead Collector. **Planning only.**

## What the repo actually is (set expectations)
`github.com/msitarzewski/agency-agents` (MIT, 127k★) is a **catalog of agent PERSONA markdown
files** (frontmatter + Role/Capabilities/Decision-Framework/Success-Metrics), grouped by
**divisions** (`divisions.json`: label + Lucide icon + color), distributed via install/convert
scripts into Claude Code / Cursor / etc.

**It has NO orchestration engine** — no planner, no DAG, no executor, no gates. Our MKTAgent
already owns that (the harder half). So we CANNOT "merge a better backbone" from it; there isn't
one. What it offers is a rich **agent-definition layer** + **prompt content** + a **taxonomy**.

## Ours vs theirs (complementary, not overlapping)
| | MKTAgent (ours) | agency-agents (theirs) |
|---|---|---|
| Orchestration | planner + artifact-DAG + executor + gates + SSE | none |
| Agent def | thin metadata (`AgentDefinition`: id/requires/produces/capabilities); prompt ad-hoc in `agent-runners.ts` | rich persona (vibe/tools/capabilities/decision-framework/success-metrics) |
| Grouping | none | divisions (label/icon/color) |
| Prompt content | terse | battle-tested, per-domain |

## 3 things worth adopting (low-risk, additive)

### A. Enrich the AgentDefinition schema (the real "backbone" upgrade)
Extend `src/orchestration/registry/agent-types.ts` `AgentDefinition` with declarative persona
fields borrowed from their frontmatter — WITHOUT dropping our orchestration fields:
- add: `vibe?`, `emoji?`, `group?` (division), `successMetrics?: string[]`, `decisionFramework?: string`,
  and a structured `systemPrompt`/`promptSections` so the prompt is DATA in the registry, not
  buried in `agent-runners.ts`.
- keep: `requires`/`produces`/`capabilities`/`requiresConnection` (our DAG wiring — their format
  has no equivalent and we must not lose it).
- payoff: agents become self-documenting + consistent; the v2 agents (Memory, Product Expert,
  Researcher, Strategist, Editor, Lead Collector) are authored to one schema; the "Neural Network"
  UI renders vibe/emoji/group/capabilities straight from the registry.
- migration: additive fields (all optional) → existing 7 agents keep working; fill persona fields
  incrementally. `agent-runners.ts` prompt can later be generated from `promptSections`.

### B. Mine their marketing prompts to strengthen our agents (content, not code)
MIT-licensed → adapt with attribution. Direct matches to our v2 agents:
- **Strategist** ← `marketing-growth-hacker` (decision framework + LTV:CAC/retention metrics — also
  feeds the **hybrid lead-scoring** rubric in Phase 01 gap 5).
- **Editor** ← `marketing-content-creator`, `marketing-instagram-curator`,
  `marketing-linkedin-content-creator`, `marketing-carousel-growth-engine` (per-platform voice).
- **Publisher** ← `marketing-multi-platform-publisher` (cross-channel adaptation, optimal-time).
- **Researcher** ← `marketing-seo-specialist` / market agents (what to research; pairs with the
  Gemini-grounding search from Phase 02).
- **Email/lead nurture** ← `marketing-email-strategist` (later, for lead follow-up).
- Method: read the relevant .md, extract the capability list + decision framework + metrics, fold
  into our agent's `promptSections` + success metrics. Do NOT install their files into the runtime
  (they target generic Claude-Code activation, not our DAG).

### C. Divisions taxonomy → agent grouping (UI + registry)
Their `divisions.json` (label + icon + color per group) is exactly the Atria mockup's agent
grouping ("Nhóm Trí tuệ / Hành động / Trợ lý" = Intelligence / Action / Assistant).
- Add a small `agent-groups` config (group id → label/icon/color) + a `group` field on
  AgentDefinition. Map our agents: Intelligence = Memory/Product Expert/Researcher/Strategist;
  Action = Editor/Publisher/Lead Collector; Assistant = orchestrator/helpers.
- Drives Phase 04's "Neural Network" grouped view with zero guesswork.

## What NOT to do
- Don't install their agents into the runtime — no orchestration, wrong activation model.
- Don't fork their scripts/app/divisions wholesale — take the schema idea + relevant prompt text.
- Don't expect an engine — we keep ours; this only upgrades the definition + content layer.

## Sequencing
After Lead Collector (Phase 01). Do A (schema) FIRST — it's the container the v2 agents (Phase 02)
are authored into; then B (prompts) while authoring each agent; C (grouping) alongside Phase 04 UI.

## Licensing
MIT — attribution required. Keep a NOTICE/attribution note when we adapt prompt text.

## Open question
- Do we want the prompt as fully data-driven `promptSections` in the registry (bigger refactor of
  agent-runners), or keep runners' prompts and only add the persona METADATA now? (Recommend: metadata
  now, data-driven prompt as an opt-in follow-up per agent — YAGNI until an agent needs it.)
