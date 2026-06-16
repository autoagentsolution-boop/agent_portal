# Runbook — Cooking Explode Pipeline (Phase 12)

Single-fixture → 2 finished mp4 (HoaiMy + NamMinh narration), 45s, 1080×1920, ~$0.13/fresh video.

Designed for **local personal use** — no credentials exposed beyond `.env`, no production upload from this script.

## TL;DR

```bash
# One-time setup (after first pull):
cd db && npx prisma migrate dev --name add_cooking_explode_pipeline
cd db && npx prisma generate

# Per-video run:
npx tsx scripts/run-cooking-explode.ts render-service/fixtures/dishes/pho-bo.json
```

Outputs under `out/cooking-explode/<slug>/`:
- `<slug>-composition.png` — Pro Banana hero
- `<slug>-motion.mp4` — Veo 8s breathing motion
- `<slug>-narration.txt` — Gemini-generated VN script
- `<slug>-music.mp3` — Suno lo-fi instrumental
- `<slug>-final-hoaimy.mp4` — finished A/B variant 1
- `<slug>-final-namminh.mp4` — finished A/B variant 2
- `<slug>-run.json` — cost + verify + size summary

## Prerequisites

| Need | Where | Notes |
|---|---|---|
| `GEMINI_API_KEY` | `.env` | Free tier OK for testing; required for composition + verify + motion + narration |
| Music library | `render-service/public/music-library/lofi-vn/*.mp3` | Drop 5-10 royalty-free tracks (60-90s each). Sources: YouTube Audio Library, Pixabay Music, Free Music Archive (CC0) |
| Postgres up | `docker compose up postgres` | Required for run_log persistence |
| Prisma migrated | see TL;DR | Adds `cooking_explode` to Pipeline enum + `motion`/`music`/`verify` to LogStep |
| `ffmpeg` on PATH | system | Override with `FFMPEG_BIN` env if needed |
| Reference image | `screenshot/foodexplode2.png` | Style ref passed to Pro Banana — required, do not delete |

### Music library setup (one-time)

```bash
mkdir -p render-service/public/music-library/lofi-vn
# Drop .mp3 / .m4a / .wav files there. Pipeline picks one per video.
# Seeded by slug → same dish always gets same track (consistent A/B).
```

**No API key required.** Override dir via `MUSIC_LIBRARY_DIR=/path/to/your/library` in `.env`.

## Cost expectations (per fresh dish)

| Step | Provider | Cost | Cached re-run |
|---|---|---|---|
| Composition (attempt 1) | Pro Banana Pro | $0.06 | $0 |
| Composition retries (worst case 3×) | Pro Banana Pro | $0.18 max | $0 |
| Vision-verify (Gemini Flash, per attempt) | Gemini Flash | ~$0.001 | re-runs |
| Veo motion 8s | Veo 3.1 Light → Fast fallback | $0.05 / $0.15 | $0 |
| Narration script | Gemini Flash | ~$0.001 | re-runs |
| TTS A/B (HoaiMy + NamMinh) | Edge TTS | $0 | $0 |
| Music | Local library | **$0** | $0 |
| **Total best case** | | **$0.11** | **~$0.002** |
| Total worst case (3 retries + Fast Veo) | | $0.34 | — |

Default `MAX_DAILY_COST_USD=2` in `.env` covers ~15 fresh videos/day.

## Pipeline stages

```
fixture.json
  ↓
[validate]  no dupes, sequential order
  ↓
[composition] Pro Banana Pro + foodexplode2.png style ref
  ↓
[vision-verify] Gemini Flash labels diff (≤1 mismatch OK; retry ×3)
  ↓
[motion]  Veo 3.1 Light i2v (8s breathing) — auto-fallback Fast on quota
  ↓
[narration] Gemini Flash → ~112 VN words (~45s @ 2.5 wps)
  ↓
[tts]     Edge TTS × 2 voices (HoaiMy + NamMinh) — free
  ↓
[music]   pick from library (seeded by slug) + ffmpeg loop+fade to length
  ↓
[encode]  ffmpeg silent video (comp 3s + motion loop 42s) + 2 audio mixes
  ↓
finals: <slug>-final-{hoaimy,namminh}.mp4 in out/cooking-explode/<slug>/
```

## Cache behavior

All assets cache to `render-service/public/explode-cache/<namespace>/<hash24>.<ext>` (gitignored). Override root via `EXPLODE_CACHE_DIR`.

| Namespace | Hash inputs | When re-pays |
|---|---|---|
| `composition` | model + slug + ref image SHA + prompt + attempt# | prompt change, fixture change, retry# bumps |
| `motion` | composition SHA + prompt + duration + preferred model | composition or prompt changes |
| `music` | n/a — picked from local library, ffmpeg loop+fade in real-time | always re-prepared (cheap) |
| TTS (existing `prisma.asset`) | voice + script SHA | script changes |

**Adding a new dish**: copy `render-service/fixtures/dishes/pho-bo.json`, edit ingredients. First run pays full price; identical re-runs are $0.

## Operations

### Add a new dish

1. Copy fixture: `cp render-service/fixtures/dishes/pho-bo.json render-service/fixtures/dishes/<slug>.json`
2. Edit: dish name, tagline, ingredients (sequential `order` 1..N, no duplicate `id`/`label`)
3. Test validation: `npx tsx scripts/build-explode-composition.ts render-service/fixtures/dishes/<slug>.json` (composition only, no motion/audio)
4. Full E2E: `npx tsx scripts/run-cooking-explode.ts render-service/fixtures/dishes/<slug>.json`
5. Review both finals in `out/cooking-explode/<slug>/` — pick winning voice
6. Upload to test channel manually (kênh test, not production)

### Diagnose failures

```bash
# Most recent cooking job
docker compose exec postgres psql -U videofarm -d videofarm -c \
  "SELECT id, status, error, cost_usd, created_at FROM video_job WHERE pipeline='cooking_explode' ORDER BY created_at DESC LIMIT 5;"

# Step-by-step logs for a job
docker compose exec postgres psql -U videofarm -d videofarm -c \
  "SELECT step, level, detail FROM run_log WHERE job_id='<id>' ORDER BY created_at;"
```

Common errors:

| Error | Cause | Fix |
|---|---|---|
| `GEMINI_API_KEY required` | `.env` missing key | Add to `.env`, do NOT commit |
| `music_library_empty` | No tracks in `render-service/public/music-library/lofi-vn/` | Drop ≥1 .mp3 file there |
| `music_library_dir_missing` | Library dir not created | `mkdir -p render-service/public/music-library/lofi-vn` |
| `pro_banana_403` / `429` | Gemini quota / billing | Check Google AI Studio quota; wait or upgrade tier |
| `veo_lite_quota_falling_back_fast` | Veo 3.1 Light daily cap | Pipeline auto-falls back to Fast ($0.15). No action needed |
| `composition_fallback_best_attempt` | 3 retries all failed label-verify | Look at `<slug>-composition.warning.json` for diff; manually accept or refine fixture |
| `ffmpeg_<stage>_exit_<n>` | ffmpeg missing or codec issue | Ensure `ffmpeg` on PATH, `ffmpeg -version` >= 6 |
| `cooking_explode` not in enum | Prisma migrate not run | `cd db && npx prisma migrate dev --name add_cooking_explode_pipeline` |

### Force re-gen (skip cache)

```bash
# Wipe cache for a slug:
rm -rf render-service/public/explode-cache/composition/*<hash>*.png
# Or wipe whole namespace:
rm -rf render-service/public/explode-cache/composition/
```

The pipeline will re-pay on next run.

### Switch Veo model preference

Default tries `veo-3.1-lite-generate-preview` → falls back to `veo-3.1-fast-generate-preview` on quota. To force Fast (e.g. quality test):

```typescript
// Edit scripts/run-cooking-explode.ts:
preferredModel: VEO_FAST,  // and pass to generateMotion
```

## Security

- **Never commit** `.env`, `<slug>-narration.txt` containing identifying info, or `out/cooking-explode/` outputs to git. All are in `.gitignore`.
- All API auth uses headers (`x-goog-api-key`, `Authorization: Bearer`) — keys never appear in URL query strings or log lines.
- Suno wrapper choice (`SUNO_API_BASE`) is yours — review the wrapper's privacy policy before sending dish/cultural data.
- Cache files contain rendered output (image/video/audio bytes) only — no API keys, no PII.

## Storyboard v2 pipeline (parallel — multi-panel ChatGPT JSON)

Different shape from v1: ChatGPT authors a per-panel JSON (intro + N steps + outro), each panel = 1 image + 1 narration + 1 Veo i2v clip. Stitched via Remotion `<Series>` with cross-dissolve.

```bash
# 1. ChatGPT generates fixture per prompt spec at:
#    plans/260616-1319-storyboard-v2/prompts/chatgpt-storyboard-v2.md
# 2. (Optional) pre-gen panel images outside pipeline + drop into
#    render-service/public/storyboard-v2/<slug>/panel-NN.png — skips Pro Banana
# 3. Run:
npx tsx scripts/run-storyboard-v2.ts render-service/fixtures/storyboard-v2/bo-kho.json \
  --images-dir=render-service/public/storyboard-v2/bo-kho
```

Flags: `--dry-run` (no API calls), `--skip-motion` ($0 preview), `--skip-tts`, `--skip-music`, `--images-dir=<path>`, `--out=<path>`, `--cost-cap=<usd>`.

Output: `out/<dishSlug>-v2.mp4` (~90 MB for 12 panels × ~6s each).

**Cost (with pre-gen images)**: 12 TTS × $0.005 + 12 Veo Lite × $0.05 = ~$0.66/fresh; $0 on re-run (per-asset cache).

**Gotchas**:
- Veo 3.1 lite/fast preview rejects `durationSeconds ∉ {4, 6, 8}` despite docs claiming 4..8. `motion-v2.ts` snaps up.
- TTS router uses Prisma → Postgres MUST be up: `docker compose up -d postgres`.
- Multi-clip render REQUIRES `<OffthreadVideo>` not `<Video>` (Html5Video timeouts on parallel mp4 loads).
- Veo Lite quota daily ~100 reqs/min — fallback to Veo Fast is automatic (same price).

## Out of scope (future phases)

- n8n automation cron — Phase 03
- Auto-gen dish fixtures from "dish name" input — Phase 03
- YouTube Shorts / Facebook Reels upload — manual for now, kênh test only
- Cost dashboard — TBD
- Multi-dish daily batch — TBD

## References

- Plan: `plans/260607-1511-cooking-explode-pipeline/`
- Research: `plans/reports/researcher-260607-1127-ai-reel-engagement-quality.md`
- Schema: `db/prisma/schema.prisma` (Pipeline.cooking_explode added)
- Cache util: `render-service/src/util/asset-cache.ts`
- Job modules: `render-service/src/jobs/gen-explode-{composition,motion}.ts`, `encode-explode-video.ts`, `cooking-run-log.ts`
- Audio: `render-service/src/audio/music-library.ts`, `render-service/src/tts/narration-script.ts`
- Vision: `render-service/src/image/vision-verify.ts`
