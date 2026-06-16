# Phase 03 — Remotion Template Update (Variable Panels + Intro/Outro + Transitions)

## Context Links
- Current template: `render-service/src/templates/cooking-explosion/CookingExplosion.tsx` (650 lines, v1 vertical-scene layout)
- Current types: `render-service/src/templates/cooking-explosion/types.ts`
- Remotion entry: `render-service/src/templates/index.tsx` → `Root.tsx`
- Phase 01 deliverables: `StoryboardV2`, `PanelV2`, `Transition` enum
- Phase 02 deliverables: `AdapterResult.panels[]` with `imagePath`, `audioPath`, `durationSec`, `transition`, `imageTextLabel`

## Overview
- **Priority**: P2 (blocker for E2E phase 05)
- **Status**: pending
- **Effort**: 5h
- **Brief**: Extend Remotion `CookingExplosion` to accept an optional `panels` prop (v2 mode). When `panels` is present, render a `<PanelSequence>` of N scenes (one per panel), each with static image + per-panel narration + transitions between scenes. v1 behavior (`steps[]` prop) untouched.

## Key Insights
- **Do NOT fork into a second composition**. One template, two render modes, discriminated by `panels !== undefined`. Reason: shared overlays (vignette, color grade), shared font + theme, single Remotion entry config.
- **Frame math**: each panel duration = `Math.round(durationSec * FPS)`. Total composition frames = `sum(panel frame counts)`. Remotion `durationInFrames` must be computed dynamically from props (use `calculateMetadata` callback in `Root.tsx`).
- **Transitions in Remotion**: built-in `@remotion/transitions` provides `<TransitionSeries>` with `linearTiming` + `fade`, `slide`, `wipe`. Map our enum: `fade`→fade, `cut`→no transition (`<Series>` not `<TransitionSeries>` for that boundary, or 0-frame fade), `zoom`→fade (v2.0 simplification per plan.md open question), `swipe`→slide.
- **Image-only scenes for v2.0**: panel `imagePath` is the visual base. Veo motion clips from phase 04 layer on top later — phase 03 ships with static images only so it can be tested in isolation.
- **Audio per panel**: each scene's `Audio src={panel.audioPath}` plays for that scene's duration. If TTS is longer than scene, Remotion will cut at scene boundary (acceptable; phase 02 logs the warning).
- **Intro/Outro text overlay**: panels with `kind === 'intro'` or `'outro'` show `imageTextLabel.line1` centered, large. `step` panels show all three label lines stacked bottom-left (so they don't cover ChatGPT's baked-in image text).

## Requirements

### Functional
1. Render N-panel composition when `panels` prop present.
2. Each scene: image background fills 1080×1920, narration audio plays, optional text overlay per `imageTextLabel`.
3. Transitions between scenes per `panel.transition` (`cut`/`fade` only for v2.0; `zoom`/`swipe` falls back to `fade`).
4. Total composition duration = sum of per-panel `durationSec`.
5. v1 path (legacy `steps` prop) UNCHANGED — same visual output as today.

### Non-functional
- Template file may exceed 200 lines (already 650). Extract `<PanelSequence>` + `<PanelScene>` into a new file `render-service/src/templates/cooking-explosion/panel-sequence.tsx` (≤200 lines) — main `CookingExplosion.tsx` adds only a 10-line branch.
- Reuse existing `Vignette`, color-grade overlay, `fontStack`, `themes`.
- Zero new top-level npm deps unless `@remotion/transitions` isn't installed (verify in step 1).

## Architecture

```
CookingExplosion (props: CookingExplosionProps | CookingExplosionV2Props)
   │
   ├── if 'panels' in props ─► <PanelSequence panels={props.panels} />
   │                              │
   │                              └─► <TransitionSeries>
   │                                   ├─ <Series.Sequence durationInFrames={...}>
   │                                   │    <PanelScene panel={p0} /> (intro)
   │                                   │  </Series.Sequence>
   │                                   ├─ <TransitionSeries.Transition presentation={fade()} timing={linearTiming(12)} />
   │                                   ├─ <Series.Sequence ...> <PanelScene panel={p1} /> </Series.Sequence>
   │                                   └─ ... etc
   │
   └── else (v1) ─► existing <VerticalScene /> path
```

`PanelScene` renders:
- `<Img src={staticFile(panel.imagePath)}>` cover-fit 1080×1920
- `<Audio src={staticFile(panel.audioPath)}>` if audioPath present
- text overlay for `imageTextLabel` (intro/outro = center large; step = bottom-left compact)
- shared overlays (vignette, color-grade) inherited from parent template

## Related Code Files
- **Modify**: `render-service/src/templates/cooking-explosion/CookingExplosion.tsx` (add v2 branch, ~10 lines added)
- **Modify**: `render-service/src/templates/cooking-explosion/types.ts` (add `CookingExplosionV2Props` discriminated union member, ~30 lines added)
- **Modify**: `render-service/src/templates/cooking-explosion/Root.tsx` (add `calculateMetadata` to compute `durationInFrames` from props.panels)
- **Create**: `render-service/src/templates/cooking-explosion/panel-sequence.tsx` (target ≤200 lines)
- **Read**: existing `CookingExplosion.tsx` (understand shared overlays to mimic in v2 mode)

## Implementation Steps

1. **Verify dep**: `cd render-service && cat package.json | grep transitions`. Install `@remotion/transitions` if missing, pinned to same major as `remotion` in package.json.
2. **Extend `types.ts`**:
   - Add `PanelV2Render = { index; kind; imagePath; audioPath?; durationSec; transition; imageTextLabel: {line1; line2; line3} }`.
   - Add `CookingExplosionV2Props = Omit<CookingExplosionProps, 'steps'> & { panels: PanelV2Render[] }`.
   - Export discriminator: `isV2Props(p): p is CookingExplosionV2Props => 'panels' in p`.
   - Add `computeCookingV2DurationInFrames(panels): number` summing per-panel frames.
3. **Author `panel-sequence.tsx`**:
   - `<PanelSequence panels variant />` returns `<TransitionSeries>` with alternating `Sequence` + `Transition`.
   - `<PanelScene panel variant />` renders image + audio + text overlay per `kind`.
   - Use `easeOutCubic` for any opacity transitions (consistency with v1).
4. **Modify `CookingExplosion.tsx`**:
   - At top of component, check `isV2Props(props)`. If true, render `<PanelSequence>` wrapped in same `<AbsoluteFill>` + shared overlays (vignette, color-grade) used in v1. Skip steam/light-rays/camera-dolly (those are bowl-specific).
   - Leave v1 branch untouched.
5. **Modify `Root.tsx`**: add `calculateMetadata({ props }) => ({ durationInFrames: isV2Props(props) ? computeCookingV2DurationInFrames(props.panels) : computeCookingDurationInFrames(props.steps.length) })`.
6. **Smoke test**: hand-craft a synthetic 3-panel `PanelV2Render[]` using 3 placeholder PNGs (any 1080×1920 image, copy from existing dish output) + 3 silent MP3s. Run `npx remotion render src/templates/index.tsx CookingExplosion out/v2-smoke.mp4 --props='{...}'`. Verify MP4 has 3 distinct scenes with correct durations.
7. **v1 regression**: render `cooking-pho-bo.json` via existing command. Verify pixel-identical (or near-identical) output to a pre-phase-03 baseline render saved to `out/baseline/`.
8. **Compile**: `npx tsc --noEmit` clean.

## Todo List
- [ ] Verify/install `@remotion/transitions`
- [ ] Extend `types.ts` with v2 props + duration helper
- [ ] Author `panel-sequence.tsx` with `<PanelSequence>` + `<PanelScene>`
- [ ] Wire v2 branch in `CookingExplosion.tsx`
- [ ] Add `calculateMetadata` to `Root.tsx`
- [ ] Save v1 baseline MP4 → out/baseline/pho-bo-pre-phase-03.mp4
- [ ] Render 3-panel synthetic v2 smoke MP4
- [ ] Re-render v1 fixture → diff against baseline (visual inspection, MP4 byte size ±5%)
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- 3-panel synthetic input renders an MP4 with 3 visually distinct scenes.
- Scene boundaries occur at frame counts matching `Math.round(durationSec * FPS)`.
- Transitions match `panel.transition` values (`cut` = hard, `fade` = visible cross-dissolve).
- v1 fixture re-render shows no regression vs baseline (visual + byte-size sanity).
- `panel-sequence.tsx` ≤200 lines.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| `calculateMetadata` not supported in current Remotion version | Low | High | Verify Remotion version ≥4.0 (which it is per existing pipeline). If older, hardcode duration via prop calc in `Composition` declaration |
| `@remotion/transitions` major-version mismatch with `remotion` | Medium | Medium | Pin install command to match remotion's major version |
| Variable-length narration MP3 exceeds scene duration → audio cuts mid-sentence | Medium | Medium | Phase 02 logs warning; future enhancement = auto-extend scene to match audio. Accept clip for v2.0. |
| Text overlay overlaps ChatGPT-baked-in image text on `step` panels | Medium | Low | Position overlay bottom-left in a 30% height band; image baked text is typically center-top per prompt examples |
| v1 regression (accidental shared-state mutation) | Low | High | Baseline-diff test (step 7 in implementation) catches before merge |

## Security Considerations
- `staticFile()` paths flow from validated `dishSlug` + zero-padded panel index. No user-controlled path segments.
- No new audio/video URLs from network — all assets come from local cache populated by phase 02.

## Next Steps
- Phase 04 layers Veo motion video on top of static panel image (replaces `<Img>` with `<Video>` when motion exists).
- Phase 05 wires adapter → template → render in one CLI command.
