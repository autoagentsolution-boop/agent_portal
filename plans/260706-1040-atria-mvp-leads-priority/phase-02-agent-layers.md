# Phase 02 — Agent layers 1-3 (Memory · Product Expert · Researcher · Strategist · Editor · Publisher)

**Priority:** P1 (after Lead Collector's tenancy/security is settled). Most are wire-up/extend, not
net-new — the executor + agent registry already exist (`src/orchestration/registry/agent-registry.ts`,
current agents: ideation, strategy, concept_writer, infographic, storyboard, video, publisher).

## Layer 1 — Foundation

### Memory agent — SMALL (data exists, needs an API)
- Have: `ProductKnowledge` library (📚), `campaign.brandContext`/`brandVoice`, persona/accountType.
- Do: a thin **Memory read/write facade** other agents call (`getProfile(ownerId)` / `remember(...)`)
  over the existing tables — not a new store. Honor the doc's decisions: selective save, ask-before-
  delete, user view/edit (the 📚 page already does view/edit/delete). Mostly consolidation.

### Product Expert — SMALL
- Have: `/product-knowledge/analyze` (docs→profile), thin-product clarification gate.
- Do: the proactive **ask-until-enough loop** — Product Expert self-assesses coverage and asks
  targeted questions in the Orchestrate chat until the profile is rich, then user confirms. Extends
  the existing clarification-engine rather than a new agent runtime.

## Layer 2 — Preparation

### Researcher — NEW (only genuinely new agent) — no external search API (user decision #5)
- **Search source = Gemini's built-in Google Search grounding** (we already call Gemini) + user-
  provided docs (reuse product-knowledge upload). Zero new provider/dependency — enable the search
  tool on the Gemini call and it retrieves + cites live results itself.
- Additive module `src/agents/researcher/`; register as `researcher` agent; emits a `research_report`
  artifact (competitor/market insight, with grounding citations) the Strategist consumes. Cost =
  the Gemini call only, counted under the credit model.
- Feasibility note: confirm the current Gemini model/tier supports search grounding; if not, fall
  back to user-docs-only for MVP and add grounding when available (no blocker).

### Strategist — extend + lead-scoring
- Have: `strategy` agent (marketing strategy).
- Do: add **lead-scoring criteria authoring** (feeds Phase 01 gap 5): user defines/adjusts weights,
  Strategist proposes defaults from the campaign goal. This is the Strategist↔Lead Collector bridge.

## Layer 3 — Production & publish

### Editor — SMALL
- Have: `concept_writer` + copy-gen + concept-versions selection gate (tone/version approval already
  exists). Maps almost 1:1 to Atria's "write sample → approve → batch". Minimal wire-up.

### Publisher — SMALL
- Have: working publisher + approval gate + per-platform asset + (new) image auto-degrade.
- Do: **optimal-time suggestion** before the approval gate (Atria's "đề xuất giờ tối ưu → duyệt").
  A heuristic/LLM suggestion surfaced in the existing publish-review; user still approves.

## Mapping summary
| Atria agent | Reuse | New work |
|---|---|---|
| Memory | ProductKnowledge + brandContext | read/write facade |
| Product Expert | analyze route + clarify gate | ask-until-enough loop |
| Researcher | — | whole agent + web search |
| Strategist | strategy agent | lead-scoring criteria |
| Editor | concept_writer + versions gate | ~none |
| Publisher | publisher + gates | optimal-time suggest |

## Success criteria
Each agent registers in the existing DAG, produces its artifact, respects the credit + approval
gates, and the existing verify suite stays green. Researcher is the only one needing a new external
dependency + its own verify.

## Notes
- Do NOT rewrite the executor — plug new agents into the existing seams (agent-registry + runners).
- Sequence so Strategist's scoring lands right after Phase 01 gap 5 (they're the same feature from
  two sides).
