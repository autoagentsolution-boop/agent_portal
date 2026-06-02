---
slug: video-content-farm-pivot
created: 2026-05-31
status: pending
branch: main
budget: 14 days (2 sprint weeks)
related_brainstorm: plans/reports/brainstorm-260531-1755-video-content-farm-pivot.md
supersedes:
  - plans/260504-1847-agent-portal-demo
  - plans/260506-1435-gmail-classifier-api-workflow
  - plans/260511-1252-prisma-cjs-cleanup
blockedBy: []
blocks: []
---

# Video Content Farm Pivot — Implementation Plan

## Goal
Pivot AgentPortal → personal local agent tự động hóa: script → image/video gen → assemble → upload YT Shorts + FB Reels. 3 pipelines (Quiz, News→Comic, Life hacks). Cost ≤ 1tr VND/mo.

## Source Docs
- Brainstorm summary: `plans/reports/brainstorm-260531-1755-video-content-farm-pivot.md`
- Old portal stack docs: `docs/` (giữ cho reference, không tái dùng implementation)

## Stack Quyết Định
- **Orchestrator:** n8n self-hosted (Docker, reuse) — schedule, retry, OAuth, upload
- **Render:** Node + Remotion (new Docker service) — webhook `/render`, CPU mode
- **DB:** Postgres (Docker, reuse) — job state, asset registry, run log
- **LLM:** Gemini 2.5 Flash (script gen)
- **Image:** Nano Banana (Gemini Image API) + reference image cho character consistency
- **TTS:** Edge TTS (free, 9 VN voices) + Google Cloud TTS ($0.5/mo, 7 voices)
- **Stock:** Pexels + Pixabay API (free)
- **Upload:** YouTube Data API v3 + Facebook Graph API (Reels endpoint)

## Architecture Diagram
```
[n8n cron] → [Gemini script] → [Nano Banana / Pexels] → [Edge/GCloud TTS]
                                        ↓
                          [render-service /render]
                                        ↓
                         [YT upload] + [FB Reels upload]
                                        ↓
                              [Postgres run_log]
```

## Service URLs (Local Dev)
| Service | URL | Purpose |
|---|---|---|
| n8n | http://localhost:5678 | Workflows, OAuth, scheduler |
| render-service | http://localhost:7000 | POST /render returns mp4 path |
| Postgres | localhost:5432 | DB (db: `videofarm`) |
| pgAdmin (optional) | http://localhost:5050 | Debug |

## Phase Progress

| # | Phase | Status | Effort |
|---|---|---|---|
| 00 | [Archive old portal + fresh skeleton](phase-00-archive-cleanup-skeleton.md) | pending | 0.5d |
| 01 | [Postgres schema + Prisma client](phase-01-postgres-schema.md) | pending | 0.5d |
| 02 | [render-service scaffold (Remotion)](phase-02-render-service-scaffold.md) | pending | 1d |
| 03 | [Quiz Countdown template](phase-03-quiz-countdown-template.md) | pending | 1d |
| 04 | [Quiz pipeline n8n workflow](phase-04-quiz-pipeline-n8n.md) | pending | 1d |
| 05 | [YT + FB OAuth + upload sub-workflow](phase-05-yt-fb-oauth-upload.md) | pending | 1d |
| 06 | [Quiz E2E ⭐MVP M1](phase-06-quiz-e2e-mvp.md) | pending | 1d |
| 07 | [News→Comic pipeline](phase-07-news-comic-pipeline.md) | pending | 2d |
| 08 | [Life hacks pipeline](phase-08-life-hacks-pipeline.md) | pending | 1.5d |
| 09 | [Multi-voice routing](phase-09-multi-voice-routing.md) | pending | 1d |
| 10 | [Logging UI + retry hardening](phase-10-logging-retry-hardening.md) | pending | 1.5d |
| 11 | [Token refresh + cold-start + demo ⭐M2](phase-11-token-refresh-coldstart-demo.md) | pending | 1d |

**Total:** ~12 effort-days (fits 14 calendar days với buffer).

## Milestones
- **M1 (end week 1, Phase 06):** Quiz pipeline E2E — 1 video tự động lên YT Shorts + FB Reels không cần touch
- **M2 (end week 2, Phase 11):** All 3 pipelines stable, cold-start test pass, FB token refresh job live

## Key Dependencies
- YouTube Data API v3 access (free, OAuth setup required)
- Facebook Page + Page Access Token (long-lived 60d)
- Google AI API key (Gemini Flash + Nano Banana)
- Google Cloud project + TTS API enabled (optional, week 2)
- Pexels API key (free)

## Open Questions (non-blocking)
- Niche cụ thể per pipeline → quyết trong week 1 trước Phase 04
- YT API access status — chưa biết
- FB Page setup status — chưa biết

## Risks (top-level)
- Account strike (mitigation: template variants, original rewrite)
- Nano Banana cost spike (mitigation: idempotent hash cache)
- Render CPU bottleneck (mitigation: queue + stagger schedule)
- FB token expire (mitigation: refresh cron in Phase 11)

## Success Criteria
- 3 pipelines auto-publish ≥7 days liên tiếp không fail
- Cost actual ≤ $20/mo
- Cold-start `docker compose up` → video lên kênh trong 1h
