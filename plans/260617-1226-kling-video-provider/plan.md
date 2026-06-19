# Kling Video Provider — Replace Veo for i2v Motion

> **Motivation**: Veo 3.1 preview models on Google AI Studio have ~2-5 req/day cap at Free tier and even Tier 1 caps at ~20/day. Team account hit 429 during Bún Mắm demo (2026-06-17). Need an alternative i2v provider with stable quota + pay-per-use billing.

## Scope

Add a second video gen backend (Kling 2.1 via Replicate) that the pipeline can dispatch to via `VIDEO_PROVIDER` env var. Veo stays as default; users can opt into Kling for quota-resilient runs.

## Non-goals

- Replace Veo permanently (keep both, switch by env)
- Build a Kling-specific prompt translator (Veo prompts work; both expect English camera + object motion description)
- Support Hailuo/Wan/Vidu yet (Replicate has all, can be added later as 1-line `case` in router)

## Decisions

| Decision | Choice | Reason |
|---|---|---|
| Kling backend | **Replicate** (`kwaivgi/kling-v2.1`) | Single Bearer token, no Chinese signup, supports Kling + Hailuo + Wan via same SDK. Replicate margin ~15% acceptable for simplicity. |
| Direct Kling official API | Defer | Requires Kuaishou partner registration, China-side billing |
| Replicate SDK vs raw fetch | **Raw fetch** (mirror Veo client) | KISS — avoid adding npm dep. Existing Veo client uses raw fetch; same pattern |
| Provider router location | `motion-v2.ts` | Single dispatch point. `gen-explode-motion.ts` (Veo) + new `gen-kling-motion.ts` (Kling) are sibling clients |
| Default provider | `veo` | Backward compat. Users opt into Kling by setting `VIDEO_PROVIDER=kling` |
| Cache key compatibility | **Different namespace per provider** | Different provider = different output quality, don't cross-hit cache. Namespace: `storyboard-clip-veo` vs `storyboard-clip-kling` |
| Image input format | **URL via local HTTP server** OR **base64 data URI** | Replicate accepts both. Use data URI to avoid running server. Encode panel-NN.png → base64 → `data:image/png;base64,...` |
| Aspect ratio | `9:16` (vertical Shorts) | All cooking videos are 9:16 |
| Duration | Snap to {5, 10} per Kling spec | Veo accepts {4,6,8}; Kling accepts {5,10}. Add `snapKlingDuration(sec)` mirroring Veo's. Sum cap [45,60] still holds. |

## Cost matrix (per video, 12 panels)

| Backend | Per-clip cost | 12 panels | TTS + misc | Total |
|---|---|---|---|---|
| **Veo 3.1 Fast** (current) | $0.05 (8s) | $0.60 | $0.06 | $0.66 |
| **Kling 2.1 Standard** (Replicate) | ~$0.10 (5s) → snap to 5 or 10 | ~$1.20-2.40 | $0.06 | $1.26-2.46 |
| **Kling 2.1 Pro** (Replicate) | ~$0.25 (5s) | ~$3.00 | $0.06 | $3.06 |
| Hailuo I2V-01 (Replicate, future) | ~$0.045 (6s) | $0.54 | $0.06 | $0.60 |

⚠️ Kling not cheaper than Veo. **Trade**: quota stability + reliable billing for higher per-clip cost. If cost matters more than reliability, add Hailuo provider next.

> Note: pricing accurate as of research date 2026-06-17. Verify on Replicate dashboard when subscribing.

## Architecture

```
scripts/run-storyboard-v2.ts
  ↓
render-service/src/storyboard/motion-v2.ts  ← PROVIDER ROUTER
  ↓
  switch (process.env.VIDEO_PROVIDER ?? 'veo')
    case 'veo'   → gen-storyboard-clips.ts (existing, calls gen-explode-motion.ts)
    case 'kling' → gen-kling-clips.ts (new, calls gen-kling-motion.ts)
  ↓
  Returns AdapterResult[] with cached mp4 paths (same shape, transparent to downstream Remotion)
```

## Phases

### B1 — Research Replicate Kling API ✅ DONE
- Endpoint: `POST https://api.replicate.com/v1/predictions`
- Auth: `Authorization: Bearer $REPLICATE_API_TOKEN`
- Polling: `GET https://api.replicate.com/v1/predictions/{id}` until status ∈ {succeeded, failed, canceled}
- Output: `prediction.output` = array of mp4 URLs
- Input shape (kwaivgi/kling-v2.1):
  - `prompt` (string)
  - `start_image` (URL or base64 data URI)
  - `duration` (5 | 10)
  - `aspect_ratio` ("16:9" | "9:16" | "1:1")
  - `negative_prompt` (optional)
  - `mode` ("standard" | "pro")

### B2 — Plan doc (this file) — IN PROGRESS

### B3 — `gen-kling-motion.ts` (new file)
- Mirror shape of `gen-explode-motion.ts`
- Functions:
  - `startKlingJob(token, input): Promise<predictionId>` — POST /predictions, returns id
  - `pollKlingJob(token, predictionId, intervalMs, timeoutMs): Promise<mp4Url>` — poll until succeeded
  - `downloadClip(url): Promise<Buffer>` — fetch mp4 to buffer
  - `generateMotion(opts)` — public API matching Veo's signature: `{ image: Buffer, prompt: string, durationSec: number, model?: string }`
- Retry on transient (429 with Retry-After, 5xx, network)
- Snap durationSec to {5, 10}: ≤5 → 5, else → 10

### B4 — Refactor `motion-v2.ts` → provider router
- Read `process.env.VIDEO_PROVIDER` (default 'veo')
- Dispatch to existing `gen-storyboard-clips.ts` (Veo) or new `gen-kling-clips.ts` (Kling)
- Cache namespace per provider: `storyboard-clip-veo` / `storyboard-clip-kling`
- Same return shape `MotionResult { panels: PanelAssets[], totals: MotionTotals }`

### B5 — Update `.env.example`
- Add `VIDEO_PROVIDER=veo` (with comment listing accepted values)
- Add `REPLICATE_API_TOKEN=` (with link to https://replicate.com/account/api-tokens)
- Add `KLING_MODEL=kwaivgi/kling-v2.1` (allow override for v2.5 later)
- Add `KLING_MODE=standard` (standard | pro)

### B6 — Dry-run wiring test
- Run pipeline with `VIDEO_PROVIDER=kling --dry-run` → verify router dispatches to Kling path, prints planned API calls without burning credits

## Future extensions (out of scope)

- **B7** Add Hailuo provider (`minimax/hailuo-i2v-01`) — cheaper than Veo + Kling
- **B8** Add Wan 2.5 (`alibaba/wan-2.5-i2v`) — Alibaba option
- **B9** Provider fallback chain: try Veo first → 429 → fallback Kling → 429 → fallback Hailuo. Single env: `VIDEO_PROVIDERS=veo,kling,hailuo`

## Risks

| Risk | Mitigation |
|---|---|
| Kling 2.1 doesn't accept ĐĂNG KÝ KÊNH 🔔 overlay in baked image | Image already baked by ChatGPT before i2v. Kling motion doesn't re-render text — should preserve. Verify with test panel. |
| Duration snap 5 → 10 breaks total cap [45,60] | If pipeline sees `durationSec: 4` and snaps to 5, total grows. 12 panels × 5 = 60s OK. But mixed (5,10) needs JSON to set durationSec explicitly to 5 or 10 only. May need ChatGPT prompt patch: "if VIDEO_PROVIDER=kling, durationSec ∈ {5,10}; else {4,6,8}" |
| Replicate per-account rate limit (~600 req/min for paid) | Practically infinite for 12-panel batches. Not a concern. |
| ChatGPT prompts targeting Veo style may not translate to Kling | Both consume EN motion direction. Same prompt should work. Verify quality via 1 test panel. |

## Migration path (when user wants to fully switch)

1. Set `VIDEO_PROVIDER=kling` in `.env`
2. Patch ChatGPT prompt: replace "durationSec ∈ {4,6,8}" with "{5,10}" + update budget recipes
3. Test 1 dish end-to-end
4. If quality acceptable, default `VIDEO_PROVIDER=kling` for new bundles
5. Keep Veo path for re-rendering legacy fixtures (cached anyway)

## Success criteria

- [x] Replicate API research documented
- [ ] `gen-kling-motion.ts` written, mirrors Veo client shape
- [ ] `motion-v2.ts` dispatches by env var without breaking Veo path
- [ ] `.env.example` updated with new vars
- [ ] Dry-run shows correct dispatch + planned API calls
- [ ] (Stretch) 1 live test panel via Kling, mp4 downloaded, quality eyeball-checked

## Unresolved questions

- Confirm exact Kling 2.1 Standard pricing on user's Replicate dashboard after subscribe — research suggests $0.10/5s but margins/promo may vary
- Verify Kling preserves baked Vietnamese text in image (intro "BÚN MẮM", outro "ĐĂNG KÝ KÊNH 🔔") without distortion across motion
- Decide whether to ship provider fallback chain (B9) or single-provider switch only — fallback adds complexity but rescues quota outages
