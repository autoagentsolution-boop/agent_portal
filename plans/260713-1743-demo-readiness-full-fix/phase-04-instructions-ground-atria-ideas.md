# P4 — User Instructions Ground Atria's Ideas

**Priority:** MED · **Status:** ✅ DONE (BE, typecheck clean, deterministic verify green) · **Layer:** backend (prompt wiring). Small.

## Done (2026-07-13)
- `resolveWorkspaceInstructionsBlock(ownerId)` in `resolve-instructions.ts` → workspace+all-agent block or null.
- Router resolves it per-request (best-effort) + threads `instructions` into `runAtriaBrain`.
- Brain injects it as a DYNAMIC preamble part on the user turn (NOT the cached system prompt) + puts it on `ctx.instructions`.
- `propose_workflow` passes `ctx.instructions` into `requirementAnalyzer.analyze(...)`; analyzer prepends an `instructionsBlock` before the memory block.
- Verify: `verify-instructions-and-memory.ts` — none→null, instruction→labeled block. LLM "angle reflects instruction" → P6 browser.

## Problem
The "Atria Instructions" system is real (DB-backed, layered workspace/campaign/post, `instruction-repo.ts`, `instructions-router.ts:37-94`, resolver `resolve-instructions.ts:34`) BUT is injected ONLY into downstream content-agent prompts (`build-agent-prompt.ts:41-45,62` via `agent-runners.ts:340-348`: concept_writer/ideation/strategy/etc.). It is NOT injected into (a) the Atria brain prompt (static/cached, `atria-brain.ts:74-79`) nor (b) the marketing `requirementAnalyzer` (`requirement-analyzer.ts:66,78` gets `memoryContext`, not instructions). So the checklist goal "all ideas follow the user's instruction setup" is only half-true: the CONTENT agents obey, but the IDEAS/plan Atria proposes don't.

## Goal
Workspace-scoped user Instructions steer Atria's reasoning + proposals, not just the content agents. Empty instructions → no change (Atria's own default) — satisfies "default to Atria if none".

## Key facts
- Resolver: `resolveInstructions({ ownerId, scope, agentId? })` (`resolve-instructions.ts:34`) composes general→specific; returns a text block.
- Brain prompt is context-cached (`atria-brain.ts:74-79`) — instructions are per-user/dynamic, so they must go in the DYNAMIC part (user/system preamble in `contents`), NOT the cached static prompt (else cache pollution / cross-tenant leak).
- Analyzer prompt: `requirement-analyzer.ts:78` prepends `memoryBlock`; add an `instructionsBlock` alongside.

## Architecture
1. Resolve workspace-scoped instructions once per request (`resolveInstructions({ ownerId, scope:'workspace' })`) in `orchestration-router.ts` (near the `recallForMessage` call ~`:235`).
2. Inject as a DYNAMIC preamble into the brain `contents` (NOT the cached static prompt) — a leading "USER INSTRUCTIONS (follow these; if empty, use your own judgment)" block, mirroring how memory should be injected (see P5).
3. Pass the same block into `propose_workflow` → `requirementAnalyzer.analyze(..., instructionsBlock)` and prepend it in `requirement-analyzer.ts:78` alongside `memoryBlock`, so proposed pillars/angles/tone honor instructions.
4. Keep the existing content-agent injection unchanged (defense-in-depth: instructions apply at both idea + content layers).

## Related code files
**Read:** `src/orchestration/prompts/resolve-instructions.ts:34`, `src/db/repos/instruction-repo.ts`, `src/orchestration/atria/atria-brain.ts:74-79,125,135-138`, `src/orchestration/atria/atria-tools.ts:217-233 (propose_workflow)`, `src/orchestration/master/requirement-analyzer.ts:66,78-83`, `src/api/orchestration-router.ts:227-237`.
**Modify:** `orchestration-router.ts` (resolve workspace instructions; pass into brain), `atria-brain.ts` (inject instructions preamble into `contents` dynamic part; thread to ctx), `atria-tools.ts` (pass instructions into analyze), `requirement-analyzer.ts` (prepend instructionsBlock).

## Implementation steps
1. Resolve workspace instructions in the router; pass `instructions` into `runAtriaBrain`.
2. In `runAtriaBrain`, prepend an instructions preamble to the dynamic `contents` (guard empty → nothing).
3. Thread instructions to `propose_workflow` → `requirementAnalyzer.analyze`; prepend `instructionsBlock` in the analyzer prompt.
4. Verify: with a workspace instruction ("always use a witty tone, target SME founders"), a proposed plan's angle/tone reflects it; with none, output unchanged.

## Todo
- [ ] Resolve workspace instructions in router
- [ ] Inject into brain dynamic contents (not cached prompt)
- [ ] Thread into requirementAnalyzer + prepend block
- [ ] `verify-instructions-ground-ideas.ts` (instruction present → reflected in proposed goal/angle; absent → unchanged)
- [ ] UI-flow verify (P6): set an Instruction on the Instructions page → new plan reflects it

## Success criteria
A workspace Instruction measurably shapes Atria's proposed ideas (angle/tone/audience), not just the final copy; no instruction → Atria's default. No prompt-cache pollution / no cross-tenant leak (instructions in the dynamic part only).

## Risk
- Do NOT put per-user instructions in the cached static system prompt (`atria-brain.ts:74-79`) → cache/tenant leak. Dynamic preamble only.
- Keep the block short/capped (instructions can be long) to protect token budget.
