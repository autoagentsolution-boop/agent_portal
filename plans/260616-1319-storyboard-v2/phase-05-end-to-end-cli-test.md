# Phase 05 — End-to-End CLI Test (Bò Kho)

## Context Links
- Phase 01 deliverables: `parseStoryboardV2`, `StoryboardV2`
- Phase 02 deliverables: `runAdapterV2`, `AdapterResult`
- Phase 04 deliverables: `generatePanelMotion`
- Phase 03 deliverables: Remotion template accepts `panels` prop
- Existing CLI pattern: `scripts/run-cooking-explode.ts` (v1 entry — read for style + flag parsing conventions)
- Existing render command: `npx remotion render src/templates/index.tsx CookingExplosion <out> --props=<json>`

## Overview
- **Priority**: P2 (proves the whole stack works end-to-end)
- **Status**: pending
- **Effort**: 3h
- **Brief**: Single CLI command that takes a v2 JSON path and produces a final MP4. Test target: Bò Kho fixture (~12 panels, ~$1.40 fresh / $0 cached).

## Key Insights
- **Single entry point pattern**: existing `scripts/run-cooking-explode.ts` is the model. New script `scripts/run-storyboard-v2.ts` follows same shape: load env, parse args, route, log, exit code.
- **Bò Kho fixture creation**: not in scope of code phases. Operator runs the ChatGPT prompt from `prompts/chatgpt-storyboard-v2.md`, pastes resulting JSON into `render-service/fixtures/storyboard-v2/bo-kho.json`. Plan documents this as a manual prerequisite (see "Unresolved questions" in plan.md).
- **Remotion props delivery**: Remotion CLI `--props=` flag has size limits on Windows command line (~32KB). 12-panel adapter output may exceed. Workaround: write adapter result to `render-service/temp/v2-render-props-<dishSlug>.json` and pass `--props=./temp/...json` (file path). Remotion supports this.
- **Audio mixing**: phase 03 already plays per-panel narration via `<Audio>` inside `<Sequence>`. Remotion handles mixing automatically. Single background music track = optional — for v2.0 leave audio = narration-only. (v1 pipeline's separate music layer is bypassed in v2 for simplicity. Document this in phase 06 runbook.)
- **Cost budget for E2E test**: 12 fresh panels = 12×$0.06 image + 12×$0.05 motion + ~$0.05 TTS ≈ $1.37. Re-runs = $0. Operator must accept this before first run.

## Requirements

### Functional
1. `npx tsx scripts/run-storyboard-v2.ts <fixture.json>` produces `out/<dishSlug>-v2.mp4`.
2. Flow: validate → adapter (images + TTS) → motion (Veo) → write props file → invoke Remotion render → emit final MP4 path + cost summary.
3. Flags:
   - `--dry-run` → validate + plan calls, no API spend, no render
   - `--skip-motion` → skip Veo step (static-image render only, ~$0.77/video)
   - `--out=<path>` → override default `out/<dishSlug>-v2.mp4`
4. Exits non-zero on validation failure, API failure (after retries), or Remotion error.
5. Logs structured cost summary at end: `{ imagesGenerated, imagesCached, motionsGenerated, motionsCached, ttsGenerated, ttsCached, totalCostUsd, durationMs }`.

### Non-functional
- Script ≤200 lines.
- Reuse `loadEnvFile` pattern from `scripts/gen-cooking-images.ts` (avoid adding `dotenv` dep).
- Use `child_process.spawn` for Remotion CLI (existing pattern in `encode-explode-video.ts`).

## Architecture

```
$ tsx scripts/run-storyboard-v2.ts fixtures/storyboard-v2/bo-kho.json

  ├─ loadEnvFile('.env')
  ├─ readFile + JSON.parse → raw
  ├─ parseStoryboardV2(raw) → StoryboardV2 (or exit 1 with field-path error)
  ├─ runAdapterV2(story, { outputRoot, dryRun }) → AdapterResult
  ├─ generatePanelMotion(adapterResult, { skipMotion }) → enhanced AdapterResult
  ├─ Build Remotion props object: { schemaVersion: 'v2', dishName, panels: [...] }
  ├─ writeFile(temp/v2-render-props-<dishSlug>.json, props)
  ├─ spawn('npx', ['remotion', 'render', 'src/templates/index.tsx', 'CookingExplosion', '<out>', '--props=./temp/...json'])
  ├─ logger.info('storyboard_v2_done', costSummary)
  └─ exit 0
```

## Related Code Files
- **Create**: `scripts/run-storyboard-v2.ts` (target ≤200 lines)
- **Create**: `render-service/fixtures/storyboard-v2/bo-kho.json` (operator-supplied; placeholder structure committed for tests if user prefers — see open question in plan.md)
- **Read**: `scripts/run-cooking-explode.ts` (style + arg parsing)
- **Read**: `scripts/gen-cooking-images.ts` (`loadEnvFile` pattern to copy)
- **Read**: `render-service/src/jobs/encode-explode-video.ts` (`spawn` pattern for ffmpeg → adapt for Remotion CLI)

## Implementation Steps

1. **Read** existing `run-cooking-explode.ts` end-to-end to match style.
2. **Create script skeleton**: `loadEnvFile`, parse `process.argv` (positional fixture path + `--dry-run`/`--skip-motion`/`--out=` flags), basic usage help on missing arg.
3. **Validation step**: read + JSON.parse fixture, call `parseStoryboardV2`. On `StoryboardValidationError`, print all issues with field paths and `process.exit(1)`.
4. **Adapter step**: call `runAdapterV2(story, { outputRoot: 'render-service/public', dryRun })`. On dry-run, print plan and exit 0.
5. **Motion step**: call `generatePanelMotion(result, { skipMotion })`. Log cost preflight from phase 04.
6. **Props file**: build props matching `CookingExplosionV2Props`, write to `render-service/temp/v2-render-props-<dishSlug>.json` (create dir if missing).
7. **Render**: `spawn('npx', ['remotion', 'render', 'src/templates/index.tsx', 'CookingExplosion', outPath, `--props=./temp/v2-render-props-${dishSlug}.json`], { cwd: 'render-service', stdio: 'inherit' })`. Await exit code.
8. **Cost summary**: aggregate counts from `adapterResult.totals` + motion preflight + log at end. Format as JSON one-liner.
9. **Manual E2E with Bò Kho**:
   - Operator generates Bò Kho v2 JSON via ChatGPT, saves to fixture path.
   - Run `npx tsx scripts/run-storyboard-v2.ts render-service/fixtures/storyboard-v2/bo-kho.json --dry-run`. Verify plan looks right.
   - Run without `--dry-run`. Wait ~15 min (12 panels × ~75s Veo + image gen serial-ish). Verify `out/bo-kho-v2.mp4` exists.
   - Open MP4: should have 12 distinct scenes, panel-baked text visible, motion subtle, narration audible.
   - Re-run same command. Verify all logs show `cache_hit`, total cost = $0, render still produces same MP4 (Remotion re-encodes but inputs cached).
10. **Compile**: `npx tsc --noEmit` clean.

## Todo List
- [ ] Author `scripts/run-storyboard-v2.ts` with flags + flow
- [ ] (Operator manual) generate Bò Kho v2 JSON via ChatGPT prompt → save to fixtures path
- [ ] Dry-run test → confirms plan
- [ ] First live run → ~$1.37 spent, MP4 produced
- [ ] Visual QA: 12 scenes, baked text visible, motion present, narration audible
- [ ] Second run (cached) → $0 spent, same MP4 reproduced
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- Single command produces final MP4 from valid v2 JSON.
- Fresh run cost matches preflight prediction within ±10%.
- Cached re-run = $0 spend.
- MP4 plays back: distinct scenes per panel, panel duration matches `durationSec` (visual stopwatch check), narration audible per scene, transitions visible per `transition` field.
- Dry-run flag exits cleanly without API spend.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| ChatGPT-generated Bò Kho JSON fails Zod validation | Medium | Low | Phase 01 error messages tell operator exactly what to fix in ChatGPT re-prompt |
| Veo run cost surprises user | Low | High | Cost preflight + COST_CAP_USD env from phase 04 |
| Remotion CLI props-file path resolution differs across cwd | Medium | Medium | Use absolute path or canonical relative-to-cwd path; test on Windows specifically |
| Total runtime >15min — user kills before completion | Medium | Medium | Log per-panel progress with `[8/12]`-style counter so user knows it's alive |
| Narration audio + scene duration mismatch → audio clipping perceived as bug | Medium | Low | Document in runbook as expected v2.0 behavior; future enhancement = auto-stretch scene |

## Security Considerations
- Fixture path passed as CLI arg → `path.resolve()` before read (no special handling, Node already safe).
- API keys via env, never logged.
- Output paths derived from validated `dishSlug` (phase 01 regex).

## Next Steps
- Phase 06 runs both v1 and v2 fixtures to confirm no regression + writes runbook updates.
