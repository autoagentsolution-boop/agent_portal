# Phase 06 — Quiz E2E ⭐ MVP M1

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-05](phase-05-yt-fb-oauth-upload.md)

## Overview
- **Priority:** Critical (Milestone M1 — end of week 1)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Verify quiz pipeline tự động chạy 7 ngày liên tiếp không cần touch. Bug-fix tour: log scrubbing, retry tuning, cost tracking, cold-restart resilience. Đặt foundation tốt cho 3 pipelines kế.

## Key Insights
- M1 không thêm feature, chỉ harden quiz pipeline
- "Không touch" = real-life test: bật cron, đi ngủ, 7 ngày sau check kênh
- Bug surface chỉ lộ khi chạy thật (DNS flake, API rate limit, cron drift)

## Requirements

### Functional
- Quiz pipeline auto run 08:00 daily, no manual intervention 7 ngày
- Each run produces:
  - 1 mp4 file trong `render-service/output/`
  - 1 video uploaded YT Shorts + 1 FB Reels (URLs in `upload_target`)
  - run_log đầy đủ cho audit
- Niche rotation: 7 ngày = 7 niches khác nhau (1-shot per niche/week)
- Cost tracking: `video_job.cost_usd` populated sau mỗi run

### Non-functional
- 0 manual intervention 7 ngày liên tiếp
- Success rate ≥ 6/7 days (1 fail allowed if root-cause documented)
- Cost actual ≤ $0.50/day for quiz pipeline
- All cron runs trigger trong ±30s scheduled time

## Architecture
(không thay đổi, tận dụng Phase 02-05)

## Acceptance Test Plan

| Day | Niche | Expected | Actual | Notes |
|---|---|---|---|---|
| 1 | Lịch sử VN | uploaded both platforms | | |
| 2 | Địa lý VN | uploaded both | | |
| 3 | Khoa học | uploaded both | | |
| 4 | Văn học | uploaded both | | |
| 5 | Thể thao | uploaded both | | |
| 6 | Ẩm thực | uploaded both | | |
| 7 | Showbiz | uploaded both | | |

Bảng này cho operator fill in trong tuần observation.

## Related Code Files
- **Modify only on bug:** files đã viết ở Phase 02-05
- **Create:** `scripts/check-pipeline-health.sh` — query Postgres status 7 ngày gần nhất, output summary
- **Create:** `docs/runbook-quiz-pipeline.md` — operator runbook

## Implementation Steps
1. Configure cron timezone Asia/Bangkok trong n8n env: `GENERIC_TIMEZONE=Asia/Bangkok`, `TZ=Asia/Bangkok`
2. Set niche rotation logic dùng `(new Date().getDay() + 6) % 7` (Mon=0)
3. Verify Docker compose restart policy: `restart: unless-stopped` cho cả 3 services
4. Write health check script:
   ```bash
   #!/usr/bin/env bash
   psql -c "SELECT created_at, pipeline, status, cost_usd FROM video_job ORDER BY created_at DESC LIMIT 7;"
   psql -c "SELECT COUNT(*) FILTER (WHERE status='published') AS ok, COUNT(*) AS total FROM video_job WHERE created_at > now() - interval '7 days';"
   ```
4. Run pipeline manual 3x consecutive (3 niches) trước khi enable cron — catch dev bugs
5. Enable cron, log "M1 start: {timestamp}"
6. Day 1-7: morning ritual — `bash scripts/check-pipeline-health.sh`, note actual values bảng trên
7. End of week: retrospective trong `plans/reports/m1-retro-{date}.md`

## Todo List
- [ ] n8n timezone + cron schedule confirmed
- [ ] Restart policy `unless-stopped` cho mọi service
- [ ] `scripts/check-pipeline-health.sh` created
- [ ] `docs/runbook-quiz-pipeline.md` — operator runbook (FAQ: "video không lên?", "FB token hết hạn?", "render fail?")
- [ ] Manual run 3 consecutive successful runs
- [ ] Cron enable, "M1 start" log
- [ ] Day 1-7: morning check + fill acceptance table
- [ ] Day 7: M1 retro report
- [ ] Tag commit `m1-quiz-mvp` nếu success

## Success Criteria (M1 milestone)
- ≥ 6/7 days uploaded thành công cả YT + FB
- 0 manual intervention required (chỉ check, không can thiệp)
- Cost actual ≤ $3.50 for 7 days
- Failure modes documented for any failed day

## Risk Assessment
- **Risk:** Docker container restart sau update Windows/system → mất state n8n cron → **Mitigation:** `restart: unless-stopped`, verify n8n catch-up on boot
- **Risk:** Niche prompt sinh content kém chất lượng → **Mitigation:** Day 1-2 monitor, refine prompt nếu cần (NOT a failure if fixed mid-week)
- **Risk:** YT/FB algo flag content → **Mitigation:** First 7 ngày dùng 1 channel/page only, không scale; nếu strike, hold M2 và analyze
- **Risk:** Gemini API quota free tier hit (1500 RPD) → **Mitigation:** Volume 1/day quiz << quota, n/a

## Security Considerations
- Daily review: scan `run_log` cho secrets leak (API keys trong error messages)
- Postgres backup: cron `pg_dump videofarm | gzip > backup/{date}.sql.gz` daily

## Next Steps (after M1 pass)
→ Phase 07: News-comic pipeline (more complex — multiple images + character ref)
