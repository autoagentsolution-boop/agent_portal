# Mandatory brief fields (#3) + per-platform asset type (#4)

Status: DRAFT — awaiting your decision on the UX fork in Phase 1.
Branch: pivot/video-content-farm

Context: follow-up to the carousel/video/language fixes (#1/#2/#5, already shipped). These two
items make the flow *consistent by construction* rather than patched after the fact.

---

## Phase 1 — Master agent collects mandatory brief fields (#3)

Goal: the brief is complete before planning, so no step drifts (empty language → mixed output;
missing asset type → wrong media node ran).

Fields the user listed:
- **Language** — currently detected/defaulted → the #5 mix. Make it explicit.
- **Length** — never asked; has a default.
- **Asset type** (image | carousel | video) — currently only *implied* by `output_format`.
  This is the field that drives media-node selection (#2) and is the anchor for #4.
- **Angle** — already asked.
- **Brand voice** — never asked; optional, brand/company only.
- **Target platforms** — already asked.

Current asks (clarification-engine.ts): product, productDetails, output_format, platforms,
accountType, targetAudience, angle — capped at `MAX_QUESTIONS=5`.

### The fork (needs your call)
Adding Language + Length + Asset type + Brand voice as **required** = up to ~9 asks. That fights
(a) the 5-question cap and (b) your "conversational, not a form" feedback.

- **Option A — Smart defaults, confirm-once (recommended).** Ask ONLY Asset type explicitly
  (it changes the whole pipeline). Default Language = the conversation language, Length = "long",
  Brand voice = account-type default. Surface all resolved values in ONE compact confirm card the
  user can override inline. Keeps it conversational; nothing silently wrong.
- **Option B — Ask all as required.** Literal reading of the request: 6 required fields, raise the
  cap. Most explicit, most form-like.
- **Option C — Two-tier.** Required: Asset type + Platforms (+ product/angle as today). Optional
  chips for Language/Length/Brand voice shown but pre-filled with defaults.

Implementation (all options): add `assetType`, `language`, `lengthSpec`, `brandVoice` handling to
`evaluateClarification` + `mergeAnswers`; map an explicit Asset-type answer onto
`goal.outputs.needs*` so the planner and the #2 gate agree.

Files: clarification-engine.ts, orchestration-mappers.ts (mergeAnswers), goal-spec.ts (assetType
slot), deterministic-analyzer.ts (parse asset type), conversation-author (voice the confirm).

---

## Phase 2 — Per-platform asset type (#4) [depends on Phase 1]

Goal: each target platform can carry its own asset type (e.g. FB=carousel, IG=video), so one run
produces multiple deliverables.

Data model (migration):
- Today: `Post.platforms: string[]` + one `Post.assetType`.
- New: a per-platform map, e.g. `Post.platformAssets: { platform: assetType }[]` (JSON column, or a
  child table). Keep `assetType` as the default/back-compat for single-type posts.

Executor impact (the "heavier storyboard"):
- Storyboard/media must fan out by DISTINCT asset type in the map: generate the carousel explainer
  slides once (for carousel platforms) AND the video keyframes+video once (for video platforms).
  De-dupe by asset type so we don't pay twice for the same type.
- Publisher fans out per platform using that platform's asset + the matching media.
- Hero model: a single `heroFile` no longer suffices — need per-asset-type media refs on the post
  (carousel CSV, video ref, image ref) and the publisher picks per platform.

Risk: touches the Post schema, the media pipeline, and the publish path. Migration must be additive
(legacy rows → single-type). Estimate: its own multi-day slice; land Phase 1 first.

---

## Already shipped (this session, context)
- #1 carousel storyboard = business-explainer slides (vs video keyframes).
- #2 media nodes gated by assetType (carousel/image skip video, no spend).
- #5 setup-language resolution + hardened prompts (content follows setup, chat mirrors input).
- Pre-video approval cost gate; idempotent post-approve; media agents set assetType to match output.
