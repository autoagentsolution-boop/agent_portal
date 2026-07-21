# Phase 05 — Verify scripts, golden snapshot, cost & budget

**Context:** [plan.md](plan.md) · depends on Phases 01-04

## Overview

**Priority:** P0 (nothing merges without this) · **Status:** pending

The plan shape for every video goal changes, so the golden snapshot and the dependency verify script
must be updated deliberately — **not** regenerated blindly to make red turn green.

## Key insights

- `planner-golden-snapshot.json` exists precisely to catch silent plan regressions. Regenerating it
  is a decision, and the diff must be **read** before it is accepted: the only expected change is
  storyboard→video_script inside video flows. Any other delta is a bug this phase must catch.
- `verify-storyboard-video-dep.ts` currently pins the behaviour being removed. It should be rewritten
  to pin the new invariant, not deleted — the invariant still matters, it just inverted.
- `plan-estimate.ts` prices agents from **historical averages** (`:46-48`). `video_script` has no
  history, so its first runs quote from whatever fallback that code path uses. Check it degrades
  sensibly rather than quoting zero.

## Requirements

- `npm run verify` green across all 83 scripts.
- The golden-snapshot diff is reviewed line by line and contains only the intended change.
- No verify script is weakened or skipped to pass. (Project rule: no fake passes.)

## Related code files

**Modify**

- `src/orchestration/verify-storyboard-video-dep.ts` — invert the invariant
- `src/orchestration/master/planner-golden-snapshot.json` — regenerate, review diff
- `src/cost/plan-estimate.ts` — ensure `video_script` and the new per-shot video cost estimate sanely

**Create**

- `src/orchestration/verify-video-script.ts` — new node's contract + duration arithmetic
- `src/orchestration/verify-infographic-overview.ts` — Phase 01's contract

## Implementation steps

1. Rewrite `verify-storyboard-video-dep.ts` to assert, with a DRY-RUN plan:
   - a video-only goal selects `video_script` **and does not select `storyboard`**
   - a carousel/storyboard-only goal selects `storyboard` **and does not select `video_script`**
   - a both goal selects both, as independent branches off `content_concept`
2. New `verify-video-script.ts` with an injected stub LLM: asserts 3-6 shots, `motion` non-empty and
   textually different from `imagePrompt`, `durationSec ∈ {4,6,8}`, `sum === totalDurationSec`,
   shot 0 is the hook with `durationSec ≤ 4`, narration present.
3. New `verify-infographic-overview.ts`: asserts the contract is present and last in the prompt, and
   that a stubbed response yields exactly one attached image with `assetType: 'image'`.
4. Regenerate the golden snapshot. **Read the diff.** Expected: video flows swap the storyboard node
   for `video_script`. Anything else = stop and investigate.
5. Run `npm run verify`. Fix real failures; do not soften assertions.
6. Re-run the audit's measurement query afterwards to confirm the media spend shape moved as intended
   (script at `scratchpad/measure-context-economics.mjs`, DB `mktagent-postgres-1` :5433).

## Todo

- [ ] Invert `verify-storyboard-video-dep.ts`
- [ ] New `verify-video-script.ts`
- [ ] New `verify-infographic-overview.ts`
- [ ] Regenerate golden snapshot + review diff
- [ ] `plan-estimate` sanity for a history-less agent
- [ ] `npm run verify` green
- [ ] Update `docs/product/05-agent-nodes-architecture.md` (node count 18 → 19, video's inputs)
- [ ] Update `docs/project-changelog.md`

## Success criteria

- All verify scripts pass without weakening any assertion.
- Golden-snapshot diff contains only storyboard→video_script inside video flows.
- Docs reflect 19 nodes and the new video dependency.

## Risks

| Risk | Mitigation |
|---|---|
| Blind snapshot regeneration hides an unrelated planning regression | Diff is reviewed line by line; this is called out as a step, not an afterthought |
| `plan-estimate` quotes ~0 for a history-less `video_script` and the cost card under-quotes | Check the fallback path explicitly; per doc 08, over-quoting is the acceptable failure direction |

## Security

`verify-*` scripts must keep the no-spend/no-network contract — all new scripts use injected stubs
(`ctx.llmJsonFn`, `ctx.imageFn`, `ctx.videoFn`), never live providers.

## Next steps

Docs update (`docs/product/05`, changelog), then the deferred UI question from Phase 04: rendering
the script at the cost gate. Multi-page / agency track remains deferred.
