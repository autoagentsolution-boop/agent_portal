# Phase 04 — Rewrite `runVideo` to execute the script

**Context:** [plan.md](plan.md) · depends on Phases 02 + 03

## Overview

**Priority:** P0 (30% of measured spend) · **Status:** pending

`runVideo` currently reads storyboard frames off `ctx.upstream.storyboard`, animates each for a
hardcoded 8s using the frame's **still-image** prompt as the motion prompt, stitches, and narrates by
concatenating image captions. Every one of those is replaced by a field the script now carries.

## Key insights

- Veo is image-to-video, so keyframes are still required. With storyboard gone from this path, the
  video node must generate them itself.
- Storyboard's **anchor mechanism** (`agent-runners.ts:648-655` — first successful frame becomes the
  reference for all later frames in `edit` mode) is the one thing in the current media pipeline that
  demonstrably works for visual consistency. **Port it, do not reinvent it.**
- Today a failed frame is skipped with a `logger.warn` (`:673-675`) because the image model returns
  200-with-no-image ~1/3 of the time. Silently shipping a 3-shot video from a 6-shot script reads to
  the user as bad quality. Surface it.

## Requirements

**Functional**

- Read `ctx.upstream.video_script`. Fail loudly with an actionable message if absent.
- Generate one keyframe per shot from `shot.imagePrompt`, anchored for consistency.
- Animate each keyframe with `shot.motion` (**not** `imagePrompt`) for `shot.durationSec`
  (**not** a constant).
- Narrate from `shot.narration` joined in shot order (**not** image captions).
- Stitch in shot order; mux the voiceover; attach as `assetType: 'video'`.

**Non-functional**

- Veo calls stay **serial** (slow, paid, rate-limited) — unchanged from today.
- Per-clip ledger rows stay one-row-per-physical-call, priced by that clip's real duration.
- Cached clips/images remain free and uncharged.

## Architecture

```
runVideo(ctx)
  ├─ script = ctx.upstream.video_script            (throw if missing)
  ├─ for each shot (serial):
  │    ├─ generateImage(imagePrompt, anchor?)      keyframe, anchored after the first success
  │    └─ generateVideo(motion, durationSec, ref)  Veo i2v, per-shot duration
  ├─ stitchClips(clips in shot order)
  ├─ generateTts(shots.map(narration).join(' '))   best-effort, falls back to silent
  ├─ muxAudio
  └─ attachPostMedia(postId, 'video', ref)
```

## Related code files

**Modify**

- `src/orchestration/executor/agent-runners.ts` — rewrite `runVideo`; drop `snapDuration` as a
  constant call site (keep the snap helper, now applied to the script's per-shot value)
- `src/orchestration/schemas/artifact-schemas.ts` — extend `videoPrompt` with `shotCount` and
  `degraded` (new fields optional so stored artifacts still parse)
- `src/cost/plan-estimate.ts` / `src/orchestration/executor/node-cost.ts` — cost now sums per-shot
  durations instead of `clips × 8s`

## Implementation steps

1. Replace the storyboard read with a `video_script` read; keep the same actionable-error style
   already used for a missing frame file (`:722`).
2. Port the anchor loop from `runStoryboard`, seeded by the post's reference image / product library
   image via the existing `resolveReferenceImage` chain, so a user-uploaded product shot still drives
   every keyframe.
3. Per shot: `generateVideo({ referenceImagePath, prompt: shot.motion, durationSec: snapDuration(shot.durationSec) })`.
4. Cost: `videoClipCost(1, shot.durationSec)` per rendered clip — Veo is priced per second, so the
   existing flat `videoClipCost(rendered)` rollup must become a per-shot sum.
5. Narration from `shot.narration`. Keep the best-effort TTS try/catch and the silent-video fallback.
6. **Degradation is reported, not swallowed:** count failed shots; if any failed, set
   `degraded: true` and `shotCount` on the artifact and `logger.warn` as today. If **all** shots
   fail, throw — same as storyboard's zero-frame guard.

## Todo

- [ ] Read `video_script`; remove the storyboard dependency
- [ ] Port anchor-based keyframe generation
- [ ] Per-shot motion prompt + per-shot duration
- [ ] Narration from `shot.narration`
- [ ] Per-shot cost rollup
- [ ] `degraded` / `shotCount` on the artifact
- [ ] Compile clean

## Success criteria

- A 5-shot script with mixed durations produces a video of exactly `sum(durationSec)`, not 40s.
- The Veo prompt for shot *n* is `shot.motion`, verifiable in the run log.
- A run where 2 of 5 keyframes fail completes with `degraded: true` and `shotCount: 3`.
- Cost recorded equals the sum of per-shot second-priced clips.

## Risks

| Risk | Mitigation |
|---|---|
| Video node now does image generation too — a second failure class inside the cost gate | The gate is **before** this node, so a human already approved the spend. Failure still bills $0. |
| Per-shot duration makes cost less predictable than a constant | Bounded: shots ≤ 6, durations ∈ {4,6,8}, so worst case 48s — identical to today's worst case. `plan-estimate` quotes worst case. |
| Losing storyboard means losing the review-the-frames-before-spending UX | The cost gate still halts before Veo. What the user reviews changes from rendered frames to the script — arguably better, since the script is editable and frames were not. **Flag for UI follow-up.** |

## Security

No new external surface. Veo and image seams are the existing injected `ctx.videoFn` / `ctx.imageFn`,
so DRY-RUN verification keeps its no-spend/no-network contract.

## Next steps

Phase 05: verify scripts, golden snapshot regeneration, cost/estimate entries.

## Open question

The cost gate previously let the user look at real generated frames before approving Veo. Now they
approve against a script. Does the review UI need to render the script (shots, motion, narration,
duration) at the gate? Almost certainly yes — **out of scope here, needs a UI phase.**
