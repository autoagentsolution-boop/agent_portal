# Phase 02 — User Instruction System (ChatGPT-style, layered)

**Priority:** FOUNDATION. **Status:** planned. **Depends on:** Phase 01 (the prompt builder is the seam).
**Goal:** Let users embed their OWN instructions — like Claude/ChatGPT custom instructions — that Atria
refers to across EVERY agent, so content is on-brand and gets better as the user refines them.

## Root cause / gap
Today the only user steer is `brandVoice` (one string) + `brandContext`, and only copy honors voice. No
free-form, layered, reusable "how I want my content" instruction the user controls; no per-agent steer.

## Approach
1. **Instruction model** — `mkt_instruction` (new table): `{ id, ownerId, scope, scopeRefId?, agentId?,
   content, enabled, updatedAt }`. Scopes: `workspace` (global, the ChatGPT-custom-instructions
   analogue), `campaign` (scopeRefId=campaignId), `post` (scopeRefId=postId). Optional `agentId` targets
   one agent (e.g. "for the image agent: always minimalist, lots of whitespace"). Free-form text.
2. **Resolution chain** — `resolveInstructions(ctx) → string[]` composes, most-general→most-specific:
   workspace → campaign → post, plus any agent-scoped ones for the current agent. Mirrors
   `resolveCopyConfig`'s inheritance. Deterministic, cached per run.
3. **Injection = one line in the Phase-01 builder** — `buildAgentPrompt` appends a clearly-delimited
   "USER INSTRUCTIONS (honor unless they violate a hard guardrail)" block from `resolveInstructions`.
   So instructions reach ideation, strategy, concept, storyboard, image, AND the new strategist — not
   just copy. Hard guardrails (no invented claims, length caps, JSON-only, language) still WIN over user
   text (documented precedence — a user can't instruction their way past a safety/contract rule).
4. **Keep `brandVoice`** — it stays as a quick structured field; instructions are the richer free-form
   layer on top (voice = "how it sounds", instructions = "how I want you to work"). Both compose.
5. **CRUD API** — `GET/PUT /instructions?scope=&refId=` (owner-scoped). Small, boring, reused by the
   Phase-08 instruction editor.
6. **Built for the Memory Agent to inherit (v2 hook).** This table + `resolveInstructions` is the
   substrate the **Memory Agent** (roadmap) will later WRITE into automatically: instructions carry a
   `source: 'user' | 'memory'` column so a learned instruction is distinguishable, reviewable, and
   revertible (never a black box). v1 = user authors them by hand; v2 = Memory observes what the user
   edits/approves + what performs (Phase-07 impact) and PROPOSES instruction updates the user accepts.
   So this phase is the "manual" version of "content gets better and better" — Memory makes it automatic.
   Phase-06 pitches turning Memory on. NO learning logic here — just the seam + the `source` field.

## Related code files
Create: `prisma` migration (`mkt_instruction`), `db/repos/instruction-repo.ts`,
`orchestration/prompts/resolve-instructions.ts`, `api/instructions-router.ts`,
`orchestration/verify-instructions.ts`.
Modify: `orchestration/prompts/build-agent-prompt.ts` (inject the block), schema.prisma, server route mount.

## Steps
1. Migration + model + repo (owner-scoped CRUD).
2. `resolveInstructions(ctx)` layered composition (workspace→campaign→post + agent-scoped).
3. Inject into `buildAgentPrompt` after the expert base, before the schema contract; guardrails win.
4. Instructions CRUD router.
5. Verify: a workspace instruction ("always end with a question", "never use emojis") appears in the
   built prompt for MULTIPLE agents; a post-scoped instruction overrides/augments; a user instruction
   that fights a hard guardrail (e.g. "write 5000 chars") does NOT break the length/JSON contract.

## Acceptance
- A user instruction set once (workspace) measurably steers content across all agents; campaign/post
  layers refine it; hard guardrails always win; brandVoice still composes.
- No agent bypasses `resolveInstructions` (single injection seam via the builder).

## Next → Phase 03 builds the Campaign Strategist ON this quality+instruction foundation.
