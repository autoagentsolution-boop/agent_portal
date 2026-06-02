# Demo Script — Video Content Farm (M2)

5-act walkthrough for portfolio / showcase purposes. Total runtime: ~12 minutes spoken.

## Setup before recording

- Docker stack up (`docker compose ps` shows postgres + n8n + render-service healthy)
- At least 7 days of historical runs in Postgres (`scripts/status.ts --week` shows real numbers)
- Browser tabs prepped: n8n UI, YouTube channel, Facebook page, IDE on `render-service/src`
- Terminal split into 2 panes: one for `docker compose logs -f render-service`, one for commands

## Act 1 — The problem (90s)

> "AI tools make video content trivially generatable. But **publishing 1-3 videos a day reliably to YouTube Shorts + Facebook Reels** — that takes operational glue. This project ships that glue, runs locally on a 16GB laptop, costs under $20/month, and has been continuously publishing for [N] days. Let me show you the architecture and a live run."

## Act 2 — Architecture (3 min)

Whiteboard or pre-made diagram:

```
n8n (cron + orchestrator)
    ↓
Gemini (script) → Nano Banana / Edge TTS / GCloud TTS / Pexels (assets)
    ↓
render-service (Express + Remotion + Prisma) → /render → mp4
    ↓
YT Data API + FB Graph Reels API (parallel branches, independent failure)
    ↓
Postgres (video_job + asset cache + upload_target + run_log)
```

Talking points:
- **Why n8n**: visual workflow editor + native OAuth credential manager → DIY OAuth code is the worst part of YT/FB integration
- **Why render-service separate**: CPU-bound Remotion encode shouldn't block the orchestrator. Single-slot mutex prevents OOM
- **Idempotency by hash**: every Nano Banana / Edge TTS call cached in `asset` table by sha256(provider+prompt). Retries don't double-spend
- **3 pipelines, 1 upload sub-workflow**: shared `upload-to-platforms` reused across Quiz / NewsComic / LifeHacks

## Act 3 — One pipeline live (4 min)

Trigger quiz pipeline manually in n8n UI. Narrate:

1. **Cron node** — normally 08:00 daily; today we trigger by hand
2. **Niche pick** — JSON file rotates by weekday
3. **Gemini call** — `responseMimeType: application/json` removes the JSON-from-markdown bug
4. **Code node validates** — `quiz_schema_invalid` if 4 options/correctIndex shape wrong → workflow fails fast
5. **Postgres INSERT** — `video_job` row appears now; jobId is the key for everything downstream
6. **Split + TTS loop** — per question, plus a `reveal` voice — different role pool → variety per video. Watch `docker logs render-service`: `tts_synthesized` lines streaming
7. **Aggregate** — audio paths merged back into props for render
8. **POST /render** — Remotion bundle hits its cached serveUrl, renders 60s at 30fps → ~90-120s on the laptop
9. **Upload sub-workflow** — YT and FB upload in parallel; one platform failing doesn't abort the other

End of act: show the new mp4 in `render-service/output/`, then the YT Short URL just published.

## Act 4 — Reliability story (2 min)

```bash
npx tsx scripts/status.ts --week
```

Walk through:
- Success rate by pipeline (target ≥ 90% / week)
- Cost by provider (Nano Banana dominant; everything else trivial)
- `--logs <jobId>` on a failed run from yesterday — show how `run_log` makes incidents legible

Then:
- `withRetry` wrapper: 3 attempts, exponential backoff, 429/5xx/network only — show one retry from yesterday's logs
- Cost cap: `MAX_DAILY_COST_USD=2`, `/preflight/cost` blocks Nano Banana when day is over budget
- FB token refresh: weekly Sunday 03:00 cron exchanges the 60-day token before it expires

## Act 5 — What's next (90s)

Honest about deferred work:
- **Analytics**: pull view counts from YT/FB APIs daily → Postgres → CLI report. Sketch the schema.
- **Multi-account scaling**: per-channel rotation when one channel saturates niche
- **GPU rental hook**: render-service abstracts to webhook; swap CPU for Runpod ComfyUI if Nano Banana costs spike
- **Semantic content filter**: current denylist is keyword-only; a Gemini classify pass before publish would catch edge cases

Close: "Source-of-truth is `plans/260531-1755-video-content-farm-pivot/`. Every commit message describes one phase. Cold-start time from `git clone` to first uploaded video: under 2 hours."

## Pre-flight checklist (before pressing record)

- [ ] Docker stack healthy
- [ ] Recent successful runs in DB
- [ ] FB token NOT expiring this week (or refresh ran successfully)
- [ ] Gemini API key NOT rate-limited
- [ ] Pexels API key valid
- [ ] One backup pre-recorded video ready in case live demo fails
- [ ] Screen recorder set to 1080p+, no notifications during recording
