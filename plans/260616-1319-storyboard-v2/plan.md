---
title: "Storyboard Schema v2 — ChatGPT JSON → Cooking Video Pipeline"
description: "Extend cooking-explode pipeline to accept ChatGPT-generated multi-panel storyboard JSON with per-panel image+motion+narration"
status: pending
priority: P2
effort: ~2.5d
branch: pivot/video-content-farm
tags: [pipeline, storyboard, schema, remotion, veo, nano-banana, backward-compat]
created: 2026-06-16
---

# Storyboard Schema v2 — Implementation Plan

## Goal
Accept ChatGPT-generated `schemaVersion: "v2"` storyboard JSON (see `prompts/chatgpt-storyboard-v2.md` section G) as a drop-in upgrade to the existing cooking-explode pipeline. Each panel carries its own `imagePrompt`, `motionDirection`, `narrationVi`, `durationSec`, `transition`. Pipeline produces panel images via Pro Banana (with cross-panel reference conditioning for visual consistency), Veo i2v motion per panel, Azure/Edge TTS per narration, Remotion composite with variable panel count + intro/outro scene kinds.

## Why v2 (vs current v1)
- v1 fixture = recipe-only (steps + ingredients) → pipeline-generated narration. Quality limited by Gemini Flash narration gen.
- v2 = ChatGPT-curated full storyboard (12+ panels with bespoke imagePrompt + motionDirection + narration). ChatGPT does the creative thinking; pipeline executes.
- v2 unlocks longer-form videos (60-90s) with proper scene structure (intro → 9+ cooking steps → outro), each scene with its own motion + voiceover beat.

## Non-Goals
- **Not rewriting v1**. v1 fixtures (`cooking-pho-bo.json`, `dishes/pho-bo.json`) MUST still render via existing path. Discriminated union on `schemaVersion`.
- Not adding new providers. Reuses existing `nano-banana.ts`, `gen-explode-motion.ts`, `tts/router.ts`, `asset-cache.ts`, ffmpeg encode.
- Not changing music gen (still library/Suno per current pipeline).

## Cost target
12-panel video: 12 × Pro Banana ($0.06) + 12 × Veo Lite ($0.05) + ~$0.05 TTS = **~$1.37/video**. Higher than v1's $0.17/video because each panel = full gen. Caching makes re-renders free. Document this clearly — operator must budget accordingly.

## Phase Progress

| # | Phase | Status | Effort | Owner files |
|---|-------|--------|--------|-------------|
| 01 | [Zod schema v2 + validator](phase-01-zod-schema-and-validator.md) | pending | 3h | `render-service/src/storyboard/schema-v2.ts`, `validate.ts` |
| 02 | [Adapter + per-panel asset pipeline](phase-02-adapter-and-asset-pipeline.md) | pending | 6h | `render-service/src/storyboard/adapter-v2.ts`, image+TTS gen wired through |
| 03 | [Remotion template — variable panels + intro/outro](phase-03-remotion-template-update.md) | pending | 5h | `CookingExplosion.tsx`, `types.ts` (extend, no break) |
| 04 | [Veo motion per-panel integration](phase-04-veo-motion-integration.md) | pending | 3h | `render-service/src/storyboard/motion-v2.ts` |
| 05 | [End-to-end CLI test (Bò Kho)](phase-05-end-to-end-cli-test.md) | pending | 3h | `scripts/run-storyboard-v2.ts`, fixture `bo-kho-v2.json` |
| 06 | [Backward compat + cleanup + docs](phase-06-backward-compat-and-cleanup.md) | pending | 2h | runbook, .env.example, schema-router |

Total: ~22h (~2.5d). Each phase is sequential (later phases depend on earlier deliverables).

## Dependency graph
```
01 (schema) ─┬─► 02 (adapter — needs validated types)
             └─► 03 (template — needs types for props)
02 ──► 04 (motion — needs adapter to feed panel.motionDirection)
02 + 03 + 04 ──► 05 (E2E — needs all three)
05 ──► 06 (compat verification — needs working E2E + v1 regression test)
```

## Key architectural decisions

1. **Discriminated union on `schemaVersion`** — single entry point script (`run-storyboard-v2.ts`) routes by `schemaVersion`. v1 fixtures unchanged.
2. **Reference image conditioning** — panel[0] (intro/hero) rendered first via `nano-banana.ts` text-to-image. Panels[1..n] rendered via `nano-banana.ts` `mode: 'edit'` with panel[0] image as `referenceImagePath`. This locks bowl/lighting/background across panels. Memory note `pro_banana_renders_vn_text` confirms this works for VN labels.
3. **Per-panel caching** — image hashed by `(modelVersion, imagePrompt, referenceImagePath_or_null)`. Motion hashed by `(imagePath, motionDirection, durationSec)`. TTS hashed by `(voiceId, narrationVi)`. Re-render same fixture = $0.
4. **Remotion template change** — extend `CookingExplosionProps` with optional `panels?: PanelV2[]`. When present, render `<PanelSequence>` (new component) instead of `<VerticalScene>`. Per-panel scene = static image + Veo motion video overlay (if available) + narration audio + transition.
5. **Veo wired through existing `gen-explode-motion.ts`** — no new Veo client. Each panel becomes a `ClipSpec` for `generateStoryboardClips` (existing function in `jobs/gen-storyboard-clips.ts` already does per-clip caching).

## Test matrix
| Layer | Test | Owner phase |
|-------|------|-------------|
| Zod schema | parse valid Bò Kho JSON → ok; parse malformed (missing field, wrong kind, sum mismatch) → throws with field path | 01 |
| Adapter | dry-run mode: prints planned API calls + hashes without executing → verify panel[0] is text-to-image, panel[1..n] use panel[0] as reference | 02 |
| Remotion | render 3-panel synthetic fixture (intro+1step+outro) → MP4 produced, panel boundaries match `durationSec` | 03 |
| Veo | inject pre-generated motion clip via cache → verify Remotion picks it up, no live API call | 04 |
| E2E | run Bò Kho v2 JSON → final MP4 with all panels, audio mixed, transitions visible | 05 |
| Regression | run v1 `cooking-pho-bo.json` after v2 merge → identical output to pre-v2 baseline | 06 |

## Rollback strategy
Each phase merges independently. Rollback = revert phase commit. v1 path is never touched, so v1 rendering can never break (verified per-phase via the regression test in phase 06).

## Open questions (resolve during impl, not blocking)
- `motionDirection` language: prompt says English preferred. Adapter passes string verbatim to Veo. **Decision**: trust ChatGPT output, no translation layer. If poor Veo results in v2 testing, add a forced-English directive to the ChatGPT prompt instead of post-processing.
- Transition rendering: `cut` = hard frame swap, `fade` = 12-frame cross-dissolve, `zoom` = scale 1.0→1.1 across last 12 frames of outgoing, `swipe` = horizontal translate. **Default**: 12-frame fade if Remotion impl complexity for `zoom`/`swipe` exceeds 1h. Treat `zoom`/`swipe` as future enhancement, render as `fade` for v2.0.
- Per-panel music ducking: out of scope. Single music track for whole video, narration mixed on top (existing `encode-explode-video.ts` already handles this).

## Unresolved questions for user
- **Bò Kho fixture content**: Plan assumes operator will run the ChatGPT prompt to generate the v2 JSON for Bò Kho before phase 05. If user wants a pre-canned synthetic fixture for testing, planner can include a hand-written one — please confirm.
- **TTS voice selection per panel**: v2 schema does not include `voiceRole`. Plan defaults all panels to single voice (selected by `dishSlug` hash, same as v1). If multi-voice (narrator + character) desired, add `voiceRole` to schema in a v2.1 follow-up.
