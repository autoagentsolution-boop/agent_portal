# Phase 01 — Infographic becomes an overview agent

**Context:** [plan.md](plan.md) · audit `plans/reports/audit-260721-1108-context-memory-cache-economics.md`

## Overview

**Priority:** P0 (43% of measured spend) · **Status:** pending

`infographic` is the only creative node with no LLM reasoning. Give it the treatment `storyboard`
already has — `promptSections` + an output contract — so it *plans* an overview visual instead of
filling one hardcoded sentence. Deliverable stays exactly one image.

## Key insights

- `storyboard` already proves this pattern works in this codebase. This is not new architecture.
- `agent-registry.ts:172` already contains the right `decisionFramework` text. It has simply never
  been executed. Phase 01 makes the declared behaviour real.
- `buildAgentPrompt('infographic')` **throws today** — `AGENT_OUTPUT_CONTRACTS` has no `infographic`
  key (`agent-prompts.ts:16` `ContractKey` union). Adding the key is a prerequisite, not an extra.
- Adding an LLM call costs ~500 prompt tokens (~$0.0002) to make a $0.040 image not generic.
  Trivially worth it, but it *does* mean this node now has an LLM cost where it had none.

## Requirements

**Functional**

- Node plans: subject, composition, structure (problem → solution → benefit), lighting/style,
  aspect ratio, on-image text content, and text density.
- On-image text is **allowed and expected** — remove the hardcoded `no text overlay`.
- On-image text must be written in the resolved run language (the same `resolveRunLanguage` chain
  copy uses), while the *image prompt* stays English (image models perform best in English).
- Aspect ratio derives from the post's target platforms (1:1 feed, 9:16 story/reels, 16:9).
- Output still attaches exactly one image, `assetType: 'image'`. No publish-validation change.

**Non-functional**

- Single-shot LLM call against a Zod contract. No loop, no retry (consistent with every other node).
- Failure mode unchanged: malformed output throws, node fails, run fails, tenant billed nothing.

## Architecture

```
runInfographic(ctx)
  ├─ resolveRunLanguage / resolveRunInstructions / resolveProductKnowledge   (unchanged helpers)
  ├─ buildAgentPrompt('infographic', {language, userInstructions})           (NEW contract key)
  ├─ callGeminiJson(system, goalContext) -> {visualBrief, imagePrompt, ...}  (NEW LLM step)
  ├─ generateImage({prompt: imagePrompt, mode: edit|text-to-image})          (unchanged seam)
  └─ attachPostMedia(postId, 'image', ref)                                   (unchanged)
```

`buildImagePrompt()` (the string template) is **deleted**, not kept as a fallback — a silent fallback
to the generic skeleton would hide regressions.

## Related code files

**Modify**

- `src/orchestration/prompts/agent-prompts.ts` — add `'infographic'` to `ContractKey`, add the contract
- `src/orchestration/registry/agent-registry.ts` — add `promptSections` to the `infographic` entry
- `src/orchestration/executor/agent-runners.ts` — rewrite `runInfographic`, delete `buildImagePrompt`
- `src/orchestration/thinking-budget.ts` — add `infographic` to the creative tier
- `src/orchestration/schemas/artifact-schemas.ts` — extend `infographic_brief` shape

**Create** — none.

## Implementation steps

1. Extend the `infographic_brief` artifact schema: keep `visualBrief` + `imagePrompt` + `imageRef`,
   add `aspectRatio` and `onImageText: string[]`. Keep new fields optional so existing stored
   artifacts still parse.
2. Add the `infographic` output contract in `agent-prompts.ts`. Require: English `imagePrompt`,
   localized `visualBrief`, localized `onImageText`, an `aspectRatio` enum.
3. Add `promptSections` (role / goal / capabilities / constraints) to the registry entry, lifting the
   existing `decisionFramework` and `successMetrics` text so the declared persona and the executed
   persona finally match.
4. Rewrite `runInfographic` to call the LLM, parse against the contract, then generate the image from
   the returned `imagePrompt`. Keep the reference-image edit-mode branch exactly as-is.
5. Add `case 'infographic':` to `thinkingBudgetFor` returning `creativeBudget(...)`.
6. Record the planning call's usage via `recordLlmUsage` with `surface: 'infographic'` (same surface,
   so the ledger keeps one row per physical call and the audit's per-surface view stays readable).

## Todo

- [ ] Extend `infographic_brief` schema (new fields optional)
- [ ] Add `infographic` to `ContractKey` + `AGENT_OUTPUT_CONTRACTS`
- [ ] Add `promptSections` to the registry entry
- [ ] Rewrite `runInfographic`; delete `buildImagePrompt`
- [ ] Add thinking-budget case
- [ ] Compile clean (`npx tsc --noEmit`)

## Success criteria

- Two different products produce visibly different `imagePrompt` structures, not one skeleton.
- `onImageText` comes back in the run language; `imagePrompt` comes back in English.
- `assetType` stays `'image'`; publisher behaviour unchanged.
- `verify-agent-prompts.ts` passes with the new contract present and last in the prompt.

## Risks

| Risk | Mitigation |
|---|---|
| A node that never failed can now fail on malformed JSON | Same failure semantics as 8 other nodes; failed run bills $0. Accepted. |
| Image model renders Vietnamese text badly | Known (`feedback_pro_banana_renders_vn_text`). Contract caps `onImageText` to short strings; user can disable via an Atria Instruction. Revisit if it regresses. |
| Latency +1 LLM call before the image | ~1-2s against a 5-20s image generation. Negligible. |

## Security

No new external surface. Product knowledge already reaches this node via `resolveProductKnowledge`
(owner-scoped through the post→campaign FK chain). No new tenant-data path.

## Next steps

Independent of Phases 02-05 — can merge alone. Does not touch the planner, so the golden snapshot
is unaffected.
