# Phase 01 — Structured Expert Prompts (one prompt builder)

**Priority:** FOUNDATION. **Status:** planned. **Depends on:** none. **Lifts every agent's output quality.**
**Goal:** Replace terse hardcoded prompts with expert-grade, structured, composable prompts — one builder
all agents share, so quality (and Phase-02 user instructions) applies everywhere by construction.

## Root cause
`orchestration/prompts/*.ts` are utilitarian ("You are X, return JSON") — no marketing persona, no
frameworks, no quality bar, no examples. Registry `promptSections` (role/goal/capabilities/constraints)
is scaffolded but UNUSED; runners still read the flat strings. `brandVoice` reaches copy only. So content
quality is capped low and inconsistent across agents.

## Approach
1. **One prompt builder** — `orchestration/prompts/build-agent-prompt.ts`:
   `buildAgentPrompt(agentId, ctx) → { system, schemaContract }`. It assembles, in layers:
   (a) the agent's **expert base** (from registry `promptSections`, now authored to expert grade),
   (b) product knowledge + resolved language (existing chains),
   (c) [Phase 02] the user's layered instructions,
   (d) the strict JSON schema contract (kept from today).
   ONE composition point → DRY, and every future quality/instruction change lands everywhere.
2. **Author expert bases** in the registry `promptSections` for each agent — persona + explicit
   frameworks + quality bars, e.g.:
   - copy/concept_writer: hook taxonomy (curiosity-gap / bold-claim / story), PAS/AIDA, per-platform
     voice, scroll-stop test, zero-invented-claims.
   - ideation: distinct angle generation + a selection rubric (differentiation, audience fit, proof).
   - strategy: positioning + funnel arc + content pillars with a "why this pillar" rationale.
   - storyboard/carousel: visual-narrative arc + cross-frame consistency anchor + on-brand rules.
   Keep the JSON-only output contract exactly as today (schemas unchanged → no runner breakage).
3. **Route runners through the builder** — ideation/strategy/concept/storyboard/infographic/image call
   `buildAgentPrompt` instead of importing a flat string. Copy-gen (`copygen/prompt.ts`) adopts the same
   base layering (it already has the richest prompt — generalize it, don't regress it).
4. **Few-shot anchors** where cheap (1 tight example per agent) — improves adherence without big token cost.

## Related code files
Create: `orchestration/prompts/build-agent-prompt.ts`, `orchestration/verify-agent-prompts.ts`.
Modify: `registry/agent-registry.ts` (author `promptSections` for all runnable agents),
`orchestration/executor/agent-runners.ts` (runners call the builder), `orchestration/prompts/*.ts`
(retire/relocate flat strings), `copygen/prompt.ts` (align to the shared base).

## Steps
1. `build-agent-prompt.ts` — layered assembler from `promptSections` + ctx + schema contract.
2. Author expert `promptSections` for each agent (persona + framework + quality bar + 1 example).
3. Point runners at the builder; keep JSON schemas + language/knowledge grounding identical.
4. Verify: builder emits a well-formed system prompt per agent (contains persona + framework + schema +
   language rule); a stub-LLM executor run still produces schema-valid artifacts (no contract break).

## Acceptance
- Every agent's prompt is expert-grade + assembled from ONE builder; JSON contracts unchanged; all
  existing executor/copygen verifies green (quality lift with zero schema regression).
- The builder is the single seam Phase 02 injects user instructions into.

## Next → Phase 02 layers the USER's own instructions into this builder.
