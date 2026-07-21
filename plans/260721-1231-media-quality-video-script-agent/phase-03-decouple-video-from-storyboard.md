# Phase 03 — Decouple `video` from `storyboard`

**Context:** [plan.md](plan.md) · depends on Phase 02 · blocks Phase 04

## Overview

**Priority:** P0 · **Status:** pending

`video ⇒ storyboard` is asserted in **6 places**, one of them an entire verify script. This phase
removes that coupling and replaces it with `video ⇒ video_script`.

**This phase alone leaves the system broken** — it breaks the old edge before Phase 04 fills the new
one. 03 and 04 land together or not at all.

## Key insights

- The dependency is not one line. It is duplicated across the schema comment, the LLM analyzer
  prompt, the UI mapper, the goal-merge disable rules, a verify script and the golden snapshot.
  Missing one leaves a video goal silently planning a storyboard it no longer uses — paying for
  3-6 images nobody consumes.
- `assetTypeFromOutputs` (`goal-spec.ts:116`) needs **no change**: `needsVideo ? 'video' : ...`
  already short-circuits before `needsStoryboard`.
- After decoupling, storyboard and video become genuinely independent deliverables — a user can ask
  for both, and they no longer share reasoning. That is the point.

## The 6 coupling sites

| # | File | What it asserts | Change |
|---|---|---|---|
| 1 | `registry/agent-registry.ts:209` | `video.requires: ['storyboard']` | → `['video_script']` |
| 2 | `prompts/requirement-prompt.ts:36` | LLM told "video DEPENDS ON storyboard; set needsStoryboard when the user wants a video" | Rewrite: storyboard and video are independent; a video does **not** imply a storyboard |
| 3 | `api/orchestration-mappers.ts:107` | `needsStoryboard = ... \|\| needsVideo` | Drop the `\|\| needsVideo` clause |
| 4 | `master/goal-merge.ts:123` | disabling storyboard also disables video | Disabling storyboard leaves video alone |
| 5 | `orchestration/verify-storyboard-video-dep.ts` | whole script pins the old edge | Rewrite to pin the new edge + assert video does NOT require storyboard |
| 6 | `master/planner-golden-snapshot.json` | video flows contain a storyboard node | Regenerate (Phase 05) |

Also check `master/clarification-engine.ts:145` and `master/deterministic-analyzer.ts:201` — both read
`needsVideo`; confirm neither infers storyboard from it.

## Requirements

- A goal with `needsVideo: true, needsStoryboard: false` plans `concept_writer → video_script → video`
  with **no** storyboard node.
- A goal with `needsStoryboard: true, needsVideo: false` plans `concept_writer → storyboard`
  **unchanged** — the carousel path must not regress.
- A goal with both plans both, as two independent branches off `content_concept`.
- Disabling one no longer disables the other.

## Related code files

**Modify** — the 6 sites above, minus the snapshot (Phase 05).

## Implementation steps

1. `agent-registry.ts` — flip `video.requires`; update `video.description` and `decisionFramework`
   (they currently describe converting storyboard frames, which will no longer be true).
2. `requirement-prompt.ts:36` — rewrite the storyboard-vs-video instruction. Keep the carousel rule
   at `:37` intact; that one is still correct and is load-bearing for the carousel path.
3. `orchestration-mappers.ts:107` — drop `|| goal.outputs.needsVideo`.
4. `goal-merge.ts:123` — `disable('storyboard')` clears only `needsStoryboard`.
5. `goal-spec.ts:19-21` — update the stale comment that documents the old dependency.
6. Grep `needsVideo` again after the edits; confirm no remaining site infers storyboard from video.

## Todo

- [ ] `video.requires` → `['video_script']` + description/decisionFramework
- [ ] `requirement-prompt.ts` storyboard-vs-video rule rewritten
- [ ] `orchestration-mappers.ts` clause dropped
- [ ] `goal-merge.ts` disable rule split
- [ ] `goal-spec.ts` comment corrected
- [ ] Re-grep `needsVideo` for stragglers
- [ ] Compile clean

## Success criteria

Covered by the rewritten verify script in Phase 05. Manual check: plan a video-only goal and confirm
the node list contains `video_script` and not `storyboard`.

## Risks

| Risk | Mitigation |
|---|---|
| A missed site silently plans an unused storyboard → 3-6 wasted images per run | Explicit 6-site table; re-grep step; verify script asserts absence, not just presence |
| Carousel path regresses | `requirement-prompt.ts:37` (carousel rule) deliberately untouched; verify script covers carousel separately |
| Existing saved flows / campaigns reference a storyboard→video edge | Saved plans are stored DAGs and replay as stored. New runs plan the new shape. Flagged as an open question below. |

## Security

None — planning-layer only, no credential or tenant path touched.

## Next steps

Phase 04 immediately. Do not commit 03 alone.

## Open question

Do stored `WorkflowRun.plan` rows for in-flight video runs need a migration, or do they replay their
stored DAG safely? The executor seeds `upstream` from `wf_artifact` rows, so a parked run should
resume on its original shape — **verify this before deploying**, do not assume.
