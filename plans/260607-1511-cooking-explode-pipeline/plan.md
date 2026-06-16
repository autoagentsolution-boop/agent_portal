---
slug: cooking-explode-pipeline
created: 2026-06-07
status: phase-02-code-done-pending-env-setup
last_updated: 2026-06-12
branch: pivot/video-content-farm
budget: 1.5-2 days (tomorrow)
related_reports:
  - plans/reports/researcher-260607-1127-ai-reel-engagement-quality.md
supersedes:
  - render-service/src/templates/cooking-explosion/CookingExplosion.tsx (journey-card layout, deprecated)
---

# Cooking Pipeline #4 — Exploded-View Hero Composition Architecture

## Goal
Replace the journey-card Remotion template with a **single high-quality static composition + subtle Veo motion + TTS + music** pipeline that produces "near-real video" quality cooking Reels at $0.17-0.19/video.

Pivoted from chained-Veo (6 clips per video, $0.55, inconsistent) → static composition (1 Pro Banana + 1 Veo i2v motion + audio, $0.17, repeatable).

## Why the pivot
- User vision = single static infographic with S-curve spiral + labels both sides + bowl at bottom (see `screenshot/foodexplode.png`, `foodexplode2.png`)
- Chained Veo clips broke the structural vision (lost the all-ingredients-at-once view, lost labels)
- Pro Banana Pro **CAN render Vietnamese text with diacritics correctly** → no Remotion text overlay needed (saved $5/mo + 3-4h dev)
- One generation produces magazine-grade key visual; Veo only needs to add gentle breathing motion

## Stack quyết định
- **Image**: `nano-banana-pro-preview` (Gemini Image API) với foodexplode2.png làm style reference
- **Motion**: `veo-3.1-lite-generate-preview` i2v ($0.05/clip 8s, gentle: broth flow + steam + breathe)
- **Audio**: Azure TTS Neural2 VN ($0.05/video) + Suno v4 music ($0.02)
- **Render**: ffmpeg (image hold + crossfade motion + audio sync)
- **Orchestration**: n8n (existing M1/M2 stack)
- **Storage**: existing Postgres run_log + asset cache

## Architecture Diagram
```
fixture.json (per dish)
    │
    ├─ validate (no dupes, all fields, sequential order)
    │
    ├─ assemble prompt from user template
    │
    ├─ Nano Banana Pro (ref=foodexplode2.png)  →  composition.png
    │
    ├─ Gemini Flash vision-verify (retry ≤3 if dupe/missing label)
    │
    ├─ Veo 3.1 Light i2v (motion)              →  motion.mp4
    │
    ├─ Azure TTS narration script gen + voice  →  narration.mp3
    │
    ├─ Suno music                              →  music.mp3
    │
    └─ ffmpeg encode → final.mp4 → upload YT Shorts + FB Reels
```

## Phase Progress

| # | Phase | Status | Effort |
|---|---|---|---|
| 01 | [Composition foundation](phase-01-composition-foundation.md) | ✅ done | 1d |
| 02 | [Full workflow build + 1 test video](phase-02-build-workflow.md) | ✅ code done (E2E run pending env setup) | 1.5d |
| 03 | n8n automation + multi-dish scaling | pending | 0.5d |

## Phase 02 completion notes (2026-06-12)

Code shipped for all 9 sub-tasks. Pre-run setup required by user:
1. `cd db && npx prisma migrate dev --name add_cooking_explode_pipeline`
2. `cd db && npx prisma generate`
3. Add `SUNO_API_KEY` to `.env` (see `.env.example`)

Run command: `npx tsx scripts/run-cooking-explode.ts render-service/fixtures/dishes/pho-bo.json`

Key design deviations from original plan:
- **TTS provider**: Edge TTS (free) replaces Azure paid client. Saves $0.05/video. Same voices (HoaiMy/NamMinh — Edge uses MS Neural). Provider abstraction kept in `narration-script.ts` for future custom-voice swap.
- **Music provider**: Pivoted Suno → local royalty-free library (2026-06-12). Suno has no public API; 3rd-party wrappers have unclear pricing + trust issues. Library mode: drop .mp3 into `render-service/public/music-library/lofi-vn/`, pick seeded by slug. **$0 forever**, no key needed.
- **Cache util location**: `render-service/src/util/asset-cache.ts` (not `jobs/`) — cross-cutting concern lives in `util/`.
- **Composition module extracted**: shared logic in `render-service/src/jobs/gen-explode-composition.ts` for both standalone gen + E2E.
- **Vision-verify prompt v2 (2026-06-12)**: First version counted ALL Vietnamese text (74 strings incl. prep/qty) producing false mismatches. v2 extracts only ALL-CAPS ingredient names (24 strings) — verified working on pho-bo with 1 mismatch at attempt 2.

See `docs/runbook-cooking-pipeline.md` for full operator guide.

## Key files (carry forward to phase 02)
- `scripts/build-explode-composition.ts` — fixture → validate → prompt → Pro Banana (reusable per dish)
- `render-service/fixtures/dishes/pho-bo.json` — phở bò fixture (23 ingredients)
- `render-service/fixtures/dishes/bun-cha.json` — bún chả fixture (19 ingredients, stress test)
- `screenshot/foodexplode2.png` — style reference, passed to Pro Banana as inline image
- `out/quality-test-d/spiral-v2/pho-bo-composition.png` — confirmed production-ready hero
- `out/quality-test-d/spiral-v2/bun-cha-composition.png` — confirmed template cross-dish (with verify-step caveat)

## Cost target
- Per video: $0.17-0.19
- Per month (30 vids): $5.10-5.70
- Budget cap: $50/mo → margin x8

## Known issues to address tomorrow
1. **Vision-verify retry loop** chưa implement — Pro Banana có thể duplicate label hoặc hallucinate (1/2 stress tests failed strict rules). Need Gemini Flash vision check + retry up to 3 times.
2. **Veo 3.1 Light quota** hit hôm nay — reset trong 24h. Fall back to Veo 3.0 fast ($0.15) nếu kẹt.
3. **TTS narration script** — chưa có generator. Tour ingredient labels theo thứ tự, 2-3s mỗi label.
4. **Motion + image timing** — composition hold 2-3s đầu, fade vào Veo motion 8s, fade out. Cần ffmpeg recipe.

## Open Questions
- TTS voice choice (male/female/specific Azure Neural2-VN voice ID)?
- Music style (instrumental/lo-fi/traditional Vietnamese)?
- Video length cap (30s/45s/60s)?
- Niche/topic strategy (chỉ pho bo + 4-5 dish khác lặp, hay 1 dish mới mỗi video)?

## Sunk learnings (today's R&D)
- Veo text-to-video không reliable cho camera transition instruction
- Veo image-to-video chain mất control framing (clip N+1 stuck in clip N state)
- Pro Banana Pro photo-realism > base Nano Banana cho hero shots
- Pro Banana Pro render Vietnamese diacritics chính xác → bỏ Remotion text overlay
- User-provided prompt template + per-dish JSON fixture = scalable formula
- Reference image conditioning (passing foodexplode2.png to Pro Banana) = composition style locked
- Total R&D cost spend: ~$2.70 across all tests

## Researcher recommendations applied
Per `plans/reports/researcher-260607-1127-ai-reel-engagement-quality.md`:
- ✅ Veo 3.1 Light $0.05/clip (vs Fast $0.15) → committed
- ✅ Pro Banana Pro for stills → committed
- ⏸ Azure Neural2 VN TTS — to commit in phase 02
- ⏸ Suno v4 music — to commit in phase 02
- ⏸ Hybrid stock+AI for Life Hacks niche — defer until cooking proven
