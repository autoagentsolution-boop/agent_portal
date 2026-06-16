# Phase 04 — Veo Motion Per-Panel Integration

## Context Links
- Existing Veo wrapper: `render-service/src/jobs/gen-explode-motion.ts` (`generateMotion({ imagePath, prompt, durationSeconds })` — quota-aware lite→fast fallback)
- Existing batched clip generator: `render-service/src/jobs/gen-storyboard-clips.ts` (`generateStoryboardClips(specs)` — already does per-clip caching via `asset-cache.getOrCompute`)
- Phase 02 output: panel-NN.png files + `AdapterResult.panels[]` carrying `motionDirection`
- Phase 03 output: `PanelV2Render` shape — we will extend it with optional `motionPath`

## Overview
- **Priority**: P2 (degrades gracefully: if Veo unavailable, template falls back to static image)
- **Status**: pending
- **Effort**: 3h
- **Brief**: For each panel, kick off a Veo 3.1 Light i2v call using `panel.imagePath` as start frame and `panel.motionDirection` as motion prompt. Cache results. Pass `motionPath` into `PanelV2Render` so phase 03 template renders `<Video>` instead of `<Img>` when present.

## Key Insights
- **Don't duplicate logic** — `generateStoryboardClips` from `jobs/gen-storyboard-clips.ts` already exists and does exactly what we need (per-clip caching, retry on transient Veo failures, lite→fast fallback). Phase 04 = build a thin adapter that converts `AdapterResult.panels[]` into `ClipSpec[]` and merges results back.
- **`durationSec` mismatch with Veo output length**: Veo Lite produces fixed 8s clips (configurable via `durationSeconds` param). Our panels may be 5-10s. Strategy: request Veo clip at `Math.min(panel.durationSec, 8)` seconds. If panel duration > 8s, template loops/holds the last frame (existing `ffmpeg` body loop logic in `encode-explode-video.ts` shows this pattern — but for Remotion we use `<Video loop>`).
- **Cost gate**: 12 panels × $0.05 = $0.60/video for motion alone. Make this opt-out via `opts.skipMotion: boolean` in adapter call. Default = enabled. Document cost in plan.md (already done) and runbook.
- **Cache hash includes `durationSec`**: re-running with same image+prompt+duration = cache hit. Different duration = new gen (small risk of waste — mitigate by rounding to nearest integer second before hashing).
- **Failure isolation**: if 2/12 panels fail Veo, the other 10 still produce motion. Failed panels fall back to static image (template handles `motionPath: undefined`).

## Requirements

### Functional
1. `generatePanelMotion(adapterResult: AdapterResult, opts: { skipMotion?: boolean }): Promise<AdapterResult>` returns new result with `motionPath` filled per panel (where successful).
2. Veo calls use `panel.imagePath` as start frame, `panel.motionDirection` as prompt, `Math.min(round(panel.durationSec), 8)` as duration.
3. Reuse `generateStoryboardClips` for actual API + cache work.
4. Failed clips logged with warning, `motionPath` left undefined for that panel, pipeline continues.
5. `skipMotion: true` returns adapterResult unchanged (no Veo calls).

### Non-functional
- File ≤200 lines.
- No new modules — `gen-storyboard-clips.ts` already handles caching + retry.

## Architecture

```
AdapterResult (from phase 02)
   │
   ▼
generatePanelMotion()
   │
   ├─ if skipMotion → return as-is
   │
   ├─ Build ClipSpec[] = panels.map(p => ({
   │     id: `${dishSlug}-panel-${p.index}`,
   │     startImagePath: absolutePath(p.imagePath),
   │     prompt: p.motionDirection,
   │     durationSec: Math.min(round(p.durationSec), 8)
   │  }))
   │
   ├─ Call generateStoryboardClips(specs)  ─► ClipResult[] (cachePath per spec)
   │
   ├─ Merge: for each panel, find matching clip by id → set panel.motionPath = clip.cachePath (or undefined if failed)
   │
   └─ Return AdapterResult with motionPath populated
```

## Related Code Files
- **Create**: `render-service/src/storyboard/motion-v2.ts` (target ≤120 lines)
- **Modify**: `render-service/src/storyboard/types-v2.ts` (add optional `motionPath?: string` to `PanelAssets`)
- **Modify**: `render-service/src/templates/cooking-explosion/panel-sequence.tsx` (phase 03 file — render `<Video src>` when `motionPath` present, else `<Img>`)
- **Modify**: `render-service/src/templates/cooking-explosion/types.ts` (add optional `motionPath?: string` to `PanelV2Render`)
- **Read**: `render-service/src/jobs/gen-storyboard-clips.ts` (use `generateStoryboardClips` as-is)
- **Read**: `render-service/src/jobs/gen-explode-motion.ts` (understand `durationSeconds` param + quota fallback)

## Implementation Steps

1. **Extend types** in `types-v2.ts`: `motionPath?: string` on per-panel asset record.
2. **Extend Remotion types** in `templates/cooking-explosion/types.ts`: `motionPath?: string` on `PanelV2Render`.
3. **Author `motion-v2.ts`**:
   - `generatePanelMotion(result, opts)` → returns enhanced `AdapterResult`.
   - Maps to `ClipSpec[]`, calls `generateStoryboardClips(specs)`.
   - Wraps `generateStoryboardClips` call in `try` — individual clip failures are already isolated inside that fn, but a top-level network blackout could throw. On total failure, log error and return adapterResult with all `motionPath` undefined (graceful degradation).
   - For each `ClipResult`, copy/symlink `cachePath` → `<outputRoot>/storyboard-v2/<dishSlug>/motion-NN.mp4` so paths are stable for `staticFile()`.
4. **Update `panel-sequence.tsx`** (phase 03 file): in `<PanelScene>`, render `<Video src={staticFile(panel.motionPath)} loop muted />` if `motionPath` present (audio comes from separate narration track), else `<Img src={staticFile(panel.imagePath)} />`. Video element fills 100% width/height with `objectFit: cover`.
5. **Cost preflight**: in `motion-v2.ts`, before calling `generateStoryboardClips`, count panels needing fresh gen (check cache first via `lookupCache` for each spec). Log `motion_cost_preflight: { freshClips: N, estCostUsd: N*0.05 }` so operator sees damage before commit. If `process.env.COST_CAP_USD` set and est > cap, throw.
6. **Smoke test**: take 3-panel synthetic from phase 03, run `generatePanelMotion`, confirm 3 motion-NN.mp4 files exist, re-render template via Remotion, verify scenes show motion instead of static.
7. **Compile**: `npx tsc --noEmit` clean.

## Todo List
- [ ] Extend `types-v2.ts` + `templates/.../types.ts` with `motionPath?`
- [ ] Author `motion-v2.ts` with `generatePanelMotion`
- [ ] Update `panel-sequence.tsx` to switch `<Video>` vs `<Img>` on `motionPath` presence
- [ ] Implement cost preflight + optional `COST_CAP_USD` env gate
- [ ] Smoke test 3-panel synthetic → motion visible in MP4
- [ ] Re-run with same input → 100% cache hits, $0 spend
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- `generatePanelMotion` produces N motion clips for N-panel input where Veo succeeds; failed panels logged but pipeline continues.
- Cache works: re-run = 0 API calls.
- Template renders `<Video>` for panels with `motionPath`, `<Img>` for panels without.
- Cost preflight log line appears before API spend with accurate fresh-clip count.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Veo quota exhausted mid-run | Medium | Medium | `gen-explode-motion.ts` already falls back lite→fast; if both quota'd, individual clip fails, pipeline continues with static images |
| Veo motion contradicts ChatGPT image (e.g. swirling ingredient that's not in image) | Medium | Low | `motionDirection` was generated alongside `imagePrompt` by same ChatGPT pass — consistent by construction. If issue, user re-prompts. |
| 12 simultaneous Veo polls hit API rate limit | Low | Medium | `generateStoryboardClips` runs serially per spec (existing impl). Acceptable runtime: 12 × ~60s = ~12min total per fresh video |
| Veo clip duration shorter than panel duration → looping motion looks janky | Medium | Low | Use `<Video loop>` + accept; if egregious, future enhancement: ffmpeg-stretch the last second to fill gap |
| Cost cap accidentally blocks legitimate run | Low | Medium | `COST_CAP_USD` opt-in only; default behavior = no cap. Document in runbook. |

## Security Considerations
- Veo API key (`GEMINI_API_KEY`) read from env via existing `gen-explode-motion.ts`. No handling in this phase.
- Motion clips cached under `render-service/public/storyboard-v2/<dishSlug>/` — safe path scope as in phase 02.

## Next Steps
- Phase 05 invokes adapter → motion → render in one CLI command.
- Phase 06 confirms v1 path untouched.
