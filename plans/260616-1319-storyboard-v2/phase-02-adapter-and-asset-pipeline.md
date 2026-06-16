# Phase 02 — Adapter + Per-Panel Asset Pipeline

## Context Links
- Schema from phase 01: `render-service/src/storyboard/schema-v2.ts`
- Image gen: `render-service/src/image/nano-banana.ts` (supports `text-to-image` + `edit` modes; already does hash-keyed cache via Prisma `asset` table)
- TTS routing: `render-service/src/tts/router.ts` (`ttsRoute(text, jobId, role)` — already hash-cached)
- Asset cache util: `render-service/src/util/asset-cache.ts` (general-purpose `getOrCompute(key, computeFn)`)
- Reference reading: `scripts/gen-cooking-images.ts` (current v1 asset gen — copy slugify, dish/ing dir layout for compatibility)

## Overview
- **Priority**: P2 (blocker for phases 04+05)
- **Status**: pending
- **Effort**: 6h
- **Brief**: Consume validated `StoryboardV2` → produce, per panel, a `PanelAssets` record `{ imagePath, audioPath, durationSec, transition, label }`. Panel[0] generated text-to-image (no reference). Panel[1..n] generated `mode: 'edit'` with panel[0] as reference image for visual consistency. TTS generated per `narrationVi`. All cached by content hash.

## Key Insights
- `nano-banana.ts` already supports `mode: 'edit'` with `referenceImagePath` — we do NOT need to modify it. Phase 02 just orchestrates the calls correctly.
- Sequential generation is mandatory for cross-panel consistency: panel[0] file must exist on disk BEFORE we kick off panel[1..n]. No `Promise.all` for the chain. Panel[1..n] CAN be parallelized after panel[0] returns (they all share the same reference, so order doesn't matter among them).
- For `kind: 'intro'` panels: no `ingredients`, no `preparation` — the prompt for image gen is just `imagePrompt` verbatim. For `kind: 'step'` panels: same — `imagePrompt` already encodes ingredients/labels. The adapter does NOT re-compose prompts; ChatGPT did that. Adapter is a thin executor.
- Asset file layout matches v1 to keep `staticFile()` working: store under `render-service/public/storyboard-v2/<dishSlug>/panel-<NN>.png` and `.../narration-<NN>.mp3`. `staticFile('storyboard-v2/bo-kho/panel-01.png')` returns the URL Remotion serves.
- TTS uses existing `ttsRoute` — pass `jobId = dishSlug`, `role = 'narrators'` (default pool). voice selection is deterministic per dish.

## Requirements

### Functional
1. `runAdapterV2(story: StoryboardV2, opts: { outputRoot: string; dryRun?: boolean }): Promise<AdapterResult>` returns per-panel asset paths.
2. Panel[0] image: `mode: 'text-to-image'`. Panel[1..n] image: `mode: 'edit'` with `referenceImagePath = panel[0].imagePath`.
3. Each TTS call uses `narrationVi`. Skip TTS if `narrationVi` is empty string (intro/outro may be silent).
4. Idempotent — re-run with same `story` = all cache hits, zero API spend.
5. `dryRun: true` → log all planned calls (provider, prompt prefix, target path), no API calls, no writes.

### Non-functional
- File size ≤200 lines.
- Use existing `withRetry` for resilience around each API call.
- Log per-panel progress (panel N of M, kind, cost-or-cached) via `logger.info`.

## Architecture

```
StoryboardV2
   │
   ▼
runAdapterV2()
   │
   ├─ Sequential: gen panel[0] image (text-to-image) ─► panel-01.png
   │
   ├─ Parallel batch (size=4): gen panel[1..n] images
   │      each: mode=edit, ref=panel-01.png  ─► panel-NN.png
   │
   ├─ Parallel batch (size=4): TTS each panel.narrationVi ─► narration-NN.mp3
   │
   └─ Return AdapterResult {
        panels: [{ index, kind, imagePath, audioPath, durationSec, transition, narrationVi, onScreenTextVi, imageTextLabel }],
        totals: { imagesGenerated, imagesCached, ttsGenerated, ttsCached, costUsd }
      }
```

## Related Code Files
- **Create**: `render-service/src/storyboard/adapter-v2.ts` (orchestrator, target ≤200 lines)
- **Create**: `render-service/src/storyboard/types-v2.ts` (`PanelAssets`, `AdapterResult` types if not derivable from Zod schema, target ≤60 lines)
- **Read**: `render-service/src/image/nano-banana.ts` (use `generate()` as-is)
- **Read**: `render-service/src/tts/router.ts` (use `ttsRoute()` as-is)
- **Read**: `scripts/gen-cooking-images.ts` (copy `slug()` function — DO NOT re-implement, factor into `render-service/src/util/slugify.ts` if it doesn't exist yet)
- **Modify**: none in this phase (we only consume existing modules)

## Implementation Steps

1. **Factor `slugify`**: If `render-service/src/util/slugify.ts` doesn't exist, extract the `slug()` function from `scripts/gen-cooking-images.ts` into it. Update the script to import from the new module. DRY.
2. **Define output paths**: `<outputRoot>/storyboard-v2/<dishSlug>/panel-NN.png` and `.../narration-NN.mp3`. `NN` zero-padded to width 2. `outputRoot` typically = `render-service/public`.
3. **Author `adapter-v2.ts`**:
   - Import `generate` from `nano-banana.ts`, `ttsRoute` from `tts/router.ts`.
   - **Step A — panel[0] image (sequential)**: call `generate({ prompt: panel[0].imagePrompt, mode: 'text-to-image' })`. The returned `outputFile` is the absolute path; copy/symlink to `<outputRoot>/storyboard-v2/<dishSlug>/panel-01.png` (or write the cache hash into a manifest and use it directly — KISS preferred: copy file).
   - **Step B — panel[1..n] images (parallel batch=4)**: `generate({ prompt: panel.imagePrompt, mode: 'edit', referenceImagePath: panel01AbsPath })`. Copy each to `panel-NN.png`.
   - **Step C — TTS (parallel batch=4)**: for each panel with non-empty `narrationVi`: `ttsRoute(narrationVi, dishSlug, 'narrators')`. Copy to `narration-NN.mp3`.
   - **Step D — assemble `AdapterResult`** with per-panel `imagePath` (relative path suitable for `staticFile()`), `audioPath`, etc.
4. **Cost accounting**: `costUsd = imagesGenerated * 0.06 + ttsGenerated * 0.005` (rough; matches existing pipeline numbers in `plan.md`).
5. **Dry-run path**: short-circuit before any `generate()`/`ttsRoute()` calls, log `{ panelIdx, mode, promptPrefix: prompt.slice(0,80), outPath, wouldHash }` and return empty `AdapterResult`.
6. **Compile + smoke**: `npx tsc --noEmit`. Then small manual smoke test: build a 3-panel synthetic `StoryboardV2` (intro + 1 step + outro), run adapter with `dryRun: true`, confirm console output shows 3 image plans + 3 TTS plans + panel[0] text-to-image, panel[1..2] edit-mode-with-ref.

## Todo List
- [ ] Factor `slugify` to `render-service/src/util/slugify.ts`; update `gen-cooking-images.ts` to import
- [ ] Author `types-v2.ts`
- [ ] Author `adapter-v2.ts` (sequential panel[0], then parallel rest, then TTS)
- [ ] Hand-build 3-panel synthetic JSON, dry-run, verify call plan
- [ ] Live-run 3-panel synthetic JSON → assets exist on disk at expected paths, re-run shows 100% cache hits
- [ ] `npx tsc --noEmit` clean

## Success Criteria
- Adapter produces N image files + N audio files for N-panel input.
- panel[0] generated first (verifiable via timestamp). panel[1..n] include panel[0] as reference (verifiable via `nano-banana` log line `image_generated` with non-empty `referenceImagePath` — add this field to the log if missing).
- Re-running adapter on same input = 0 API calls, all cache-hit logs.
- Dry-run prints all planned calls and exits without API spend.

## Risk Assessment
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Pro Banana rejects reference image (size/format) | Medium | High | `nano-banana.ts` already retries; if persistent, fall back to text-to-image for panel[1..n] and log warning |
| Parallel batch overwhelms API quota | Medium | Medium | Batch size = 4 (proven safe in `gen-cooking-images.ts`); reduce to 2 if 429s appear |
| Panel[0] gen fails → blocks entire pipeline | Low | High | `withRetry` (3 attempts); on final failure, throw with clear "no reference image, cannot proceed" message |
| Disk fills from cached PNGs (~500KB × 12 panels × N dishes) | Low | Low | Document cache size in runbook; offer `npm run cache:prune` in phase 06 if needed |
| TTS narration too long (Vietnamese verbosity) overflows panel `durationSec` | Medium | Medium | Log warning when audio duration > panel.durationSec by >0.5s; phase 03 template clips audio at scene boundary |

## Security Considerations
- `dishSlug` validated in phase 01 → safe to use in `path.join`. No additional sanitization needed here.
- API keys read from env via existing modules — adapter does not handle keys directly.
- File writes scoped to `<outputRoot>/storyboard-v2/<dishSlug>/` — no traversal possible.

## Next Steps
- Phase 03 consumes `AdapterResult.panels[]` as Remotion props.
- Phase 04 layers Veo motion on top of the image assets produced here.
- Phase 05 wires everything in a single CLI script.
