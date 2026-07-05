# Storyboard = real images · Video = Veo i2v from those images

## Correct intent (user 2026-07-05, corrected)
- **storyboard** agent → generates **N real images** (3-6 frames introducing the product,
  LLM decides count from the concept) → review shows an image gallery.
- **video** agent → **Veo image-to-video per frame → ffmpeg stitch** → one mp4 → review shows a
  video player. Uses ALL storyboard frames.

Prior (wrong) impl produced text script/prompt — being replaced.

## Existing pieces to reuse
- Image gen: `src/imagegen/nano-banana.ts` `generate({prompt, mode})` — one image/call.
- Veo i2v: portable from `scripts/veo-i2v-tilt-test.ts` `genVeoI2V(apiKey, imgPath, model)` —
  `predictLongRunning`, model `veo-3.1-lite-generate-preview`, poll → mp4 (inline b64 or URI).
- Review UI already renders images (`<img class="artifact-image">` in post-workflow-view when the
  artifact view has `imageUrl`). Media served at `/media/images` (static).

## Phase 1 — storyboard → images (cheap, testable first)
- Schema `storyboard` → `{ frames: [{ index, imageRef, caption, imagePrompt }] }`.
- `storyboardSystemPrompt` → output `{ frames: [{ index, imagePrompt(EN), caption(campaign lang) }] }`,
  3-6 frames, grounded in content_concept + product knowledge.
- `runStoryboard`: LLM plan → gen image per frame (nano-banana) → attach imageRef. Cost = N×image.
- Review: `artifact-format` storyboard → gallery of imageUrls; `post-workflow-view` renders multiple
  images (extend the single-image view to an array).
- DRY stubs: storyboard now uses imageFn (stubbed) + llmJsonFn (new frame shape) → update stubLlmJson
  in the 4 verify scripts.

## Phase 2 — video → Veo i2v + stitch
- New `src/video/veo.ts` — `generateVideoFromImage(imagePath, prompt, {durationSec, aspectRatio})`
  → mp4 path (ported genVeoI2V, GEMINI_API_KEY, veo-3.1-lite, poll ≤10min).
- New `src/video/stitch.ts` — ffmpeg concat N mp4 → 1 mp4 (concat demuxer).
- Dockerfile: install ffmpeg in the image.
- `VIDEO_OUTPUT_DIR` + serve `/media/videos` static (mirror /media/images).
- Schema `video_prompt` → `{ videoRef, durationSec, clipCount }` (keep the enum key `video_prompt`).
- `runVideo`: read storyboard.frames → Veo i2v each frame image → stitch → video ref →
  set post.heroFile = video ref (the deliverable). Add a `videoFn` seam on RunnerContext for DRY.
- Review: `artifact-format` video → videoUrl; `post-workflow-view` renders `<video controls>`.
- DRY stubs: add stub videoFn.

## Cost / ops (user aware)
- Veo i2v: ~1-2 min/clip, real $, Tier-1 2-5 RPM → N frames = N calls (slow, serialize + small delay).
- ffmpeg added to the Docker image (~batch layer).

## Verify
- BE typecheck + web build clean. verify-executor (DAG DRY) green with new shapes + stub videoFn.
- Live smoke: one storyboard (real images) then one video (real Veo, 2-3 frames) — confirm gallery +
  player render. Watch spend (few clips only).

## Deferred
- Per-frame TTS/music (storyboard-v2 has it) — out of scope now.
- content_search stays stub.
