# Phase 11 — Token Refresh + Cold-Start + Demo Script ⭐ M2

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-10](phase-10-logging-retry-hardening.md)

## Overview
- **Priority:** High (M2 milestone — production-ready stamp)
- **Status:** pending
- **Effort:** 1 day
- **Brief:** Wire FB Page token refresh weekly cron. Run cold-start test (`docker compose down -v && up`) end-to-end. Write README quickstart + runbook. Tag git `m2-all-pipelines-stable`.

## Key Insights
- FB Page token expires after 60-90 days silently — `n8n` continues to retry với expired token → flood errors. Refresh job weekly catches early.
- Cold-start test = "newcomer can run this" test. Reveal hidden manual steps documenting glossed over
- YT OAuth refresh token auto-handled by n8n YouTube node — không cần custom logic

## Requirements

### Functional
- **FB token refresh workflow** (weekly Sunday 03:00):
  - GET `/oauth/access_token?grant_type=fb_exchange_token&...&fb_exchange_token={current_token}`
  - Response: new long-lived token (60-90 day extension)
  - Update n8n credential via internal API OR write to .env + signal n8n restart (depending on n8n version)
  - Alert nếu fail: log + email/Slack webhook (optional)
- **Cold-start test**:
  - `docker compose down -v` (destroy volumes)
  - `docker compose up -d` from scratch
  - Run init migration (`npm run db:migrate`)
  - Manually re-create n8n credentials (cannot avoid — secrets)
  - Import workflow JSONs: `docker compose exec n8n n8n import:workflow --separate --input=/workflows`
  - Trigger 1 video per pipeline manually
  - Pass: 3 videos uploaded successfully
- **README quickstart**:
  - Prerequisites (Docker, Node 20, OAuth credentials)
  - 1st time setup steps (15-step list, no shortcuts)
  - Daily operations (cron là chính, không cần intervention)
  - Troubleshooting table
- **DEMO_SCRIPT.md**: nếu cần show off video pipeline (e.g. portfolio), 5-act flow

### Non-functional
- Cold-start tổng thời gian: ≤ 2 hours từ git clone → first uploaded video
- Token refresh idempotent: chạy 2 lần liên tiếp không break

## Architecture

```
[Cron Sunday 03:00] → [HTTP FB exchange token]
                              ↓
                       [Code: parse new token]
                              ↓
                  [HTTP n8n internal API: update credential]
                              ↓
                  [Postgres: log refresh event]
                              ↓
                  [Optional: webhook alert if failed]
```

## Related Code Files
- **Create:** `n8n-workflows/fb-token-refresh.json`
- **Create:** `docs/runbook-cold-start.md`
- **Create:** `DEMO_SCRIPT.md` (5-act walkthrough)
- **Modify:** `README.md` quickstart section
- **Create:** `docs/troubleshooting.md` (FAQ table)

## Implementation Steps

### FB Token Refresh
1. Document FB app ID + secret saved trong `.env` (`FB_APP_ID`, `FB_APP_SECRET`)
2. n8n workflow:
   - Cron Sunday 03:00
   - HTTP node: `GET https://graph.facebook.com/v18.0/oauth/access_token?grant_type=fb_exchange_token&client_id={{$env.FB_APP_ID}}&client_secret={{$env.FB_APP_SECRET}}&fb_exchange_token={{current_token}}`
   - Code: extract `access_token`
   - HTTP node: PATCH n8n internal API `/api/v1/credentials/{cred_id}` với new token (auth via N8N_API_KEY)
   - OR: write to `.env` file via shell node + signal n8n container restart
   - Postgres INSERT run_log type='token_refresh'
3. Test: trigger manual → verify n8n credential updated → re-run quiz pipeline → still uploads
4. Document trong runbook: "if refresh fails, manual steps to re-obtain token"

### Cold-Start Verification
1. Backup current state: `pg_dump` + n8n workflow exports + .env
2. `docker compose down -v` (DESTRUCTIVE — sau backup)
3. Follow README from scratch (1 outside-the-loop person ideal, hoặc operator giả vờ là newcomer)
4. Time each step, note steps không có trong README
5. Update README based on findings
6. Trigger 1 video per pipeline manually → 3 videos lên kênh
7. Pass criteria: < 2h tổng, 3/3 pipelines work

### README + Docs
1. README sections:
   - Overview (3 pipelines, what they do)
   - Prerequisites
   - Setup (8-step list, link to OAuth doc)
   - Run (`docker compose up -d`)
   - Verify (`npm run status`)
   - Troubleshooting (link to docs/troubleshooting.md)
2. troubleshooting.md table:
   | Symptom | Likely Cause | Fix |
   |---|---|---|
   | Video không lên YT | OAuth token revoked | re-authorize trong n8n credential |
   | FB upload 401 | Token expired | manual refresh workflow trigger |
   | Render timeout | CPU saturated | check `npm run status -- --jobs` cho hung renders |
   | Cron không chạy | n8n container restart, no catch-up | `docker compose restart n8n` |
3. DEMO_SCRIPT.md: 5-act flow nếu cần demo cho ai (portfolio/CV)

## Todo List
- [ ] FB token refresh workflow built + tested
- [ ] Refresh job: manual trigger → token updated → quiz pipeline still works
- [ ] Backup current state
- [ ] Cold-start `docker compose down -v && up` from scratch
- [ ] Time the cold-start, < 2h target
- [ ] 3 pipelines run successfully post-cold-start
- [ ] Update README + runbook based on findings
- [ ] Write troubleshooting table (≥ 10 entries)
- [ ] DEMO_SCRIPT.md (optional, nếu cần)
- [ ] Git tag `m2-all-pipelines-stable`

## Success Criteria (M2 milestone)
- FB token refresh works: manual trigger updates n8n credential, post-refresh upload succeeds
- Cold-start: 1 newcomer (or operator giả) follow README → 3 videos uploaded trong 2h
- README đủ self-service: 0 questions outside the docs
- 7 ngày sau M2: all 3 pipelines vẫn auto-run, FB token refresh job runs 1 lần thành công

## Risk Assessment
- **Risk:** n8n internal API thay đổi giữa versions → credential update fail → **Mitigation:** Try n8n CLI alternative `n8n credentials:update`, document trong runbook
- **Risk:** Cold-start exposes hidden manual step → **Accept:** that's the point of test, document found gaps
- **Risk:** FB app review required cho long-lived token → **Mitigation:** Personal tier may not — verify ahead, if needed go through "Business Login" flow

## Security Considerations
- Token refresh logs KHÔNG include token value, chỉ length + expiry date
- N8N_API_KEY (for credential update) trong env, không hardcode
- `.env` permission 0600 trên host

## Next Steps (post-M2)
Optional Phase 12 (post-MVP, not scheduled trong 2 tuần):
- Analytics dashboard: pull YT/FB view count daily → Postgres → CLI report
- A/B template variants tracking
- Multi-niche scaling (per-channel rotation)
- GPU rental wire khi cost > budget
