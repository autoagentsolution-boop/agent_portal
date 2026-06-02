# Runbook — Quiz Pipeline (M1 operator guide)

Daily and incident response procedures for the quiz pipeline. Read before enabling cron.

## TL;DR

| Symptom | First check | Fix |
|---|---|---|
| No video on channel today | `bash scripts/check-pipeline-health.sh 1` | See §2 |
| FB token expired | Last `run_log` entry mentions `Permissions error` or `OAuth` | §3 — regenerate token |
| Render fails repeatedly | `docker compose logs render-service \| tail -50` | §4 |
| Same niche 2 days in a row | n8n container restarted, weekday cache stale | Restart n8n: `docker compose restart n8n` |
| Gemini quota | HTTP 429 in `run_log.detail` | Volume should be <2 RPM, escalate to paid tier if hit |

## 1. Daily morning ritual (during M1 observation)

```bash
bash scripts/check-pipeline-health.sh 1
```

Fill the M1 acceptance table in `plans/260531-1755-video-content-farm-pivot/phase-06-quiz-e2e-mvp.md`. Note exactly which platforms uploaded and which didn't.

If yesterday's row has `status='failed'` → §2.

## 2. "Video không lên hôm nay" — diagnostic flow

```bash
# 1. Was the job created at all?
docker compose exec postgres psql -U videofarm -d videofarm -c \
  "SELECT id, status, error, created_at FROM video_job WHERE created_at > now() - interval '1 day' ORDER BY created_at DESC;"
```

Branch on result:

- **No row at all** → cron didn't fire. Check:
  - `docker compose ps` — is n8n running?
  - n8n UI → Executions tab → look for failed cron trigger
  - Possible cause: n8n container restarted between scheduled time and check time (n8n misses cron during downtime)
  - Fix: rare — accept as 1 missed day, no manual recovery

- **Row exists, `status='failed'`** → look at `error` column + corresponding `run_log` entries:
  ```bash
  docker compose exec postgres psql -U videofarm -d videofarm -c \
    "SELECT step, level, detail FROM run_log WHERE job_id='<id>' ORDER BY created_at;"
  ```
  Common failure modes:
  - `quiz_schema_invalid` → Gemini returned bad JSON. Re-trigger workflow manually; if persistent, refine prompt
  - `edge-tts exit 1` → TTS subprocess failed. Restart render-service: `docker compose restart render-service`
  - `Could not connect to render-service` → render-service down. Check `docker compose ps`, logs
  - `5xx from /render` → likely Remotion bundle issue; check `docker compose logs render-service`

- **Row exists, `status='rendered'`, no upload** → upload sub-workflow failed:
  ```bash
  docker compose exec postgres psql -U videofarm -d videofarm -c \
    "SELECT platform, status, error FROM upload_target WHERE job_id='<id>';"
  ```
  - YT `quota exceeded` → wait until next day (10K units/day reset at midnight Pacific time)
  - FB `OAuth` errors → §3
  - YT `tags malformed` → check `tags` array length and total char count (max 500 chars total)

## 3. FB Page token rotation (every ~50 days during M1)

Token lives 60 days. Refresh proactively:

```bash
curl -G "https://graph.facebook.com/v18.0/oauth/access_token" \
  -d "grant_type=fb_exchange_token" \
  -d "client_id=$FB_APP_ID" \
  -d "client_secret=$FB_APP_SECRET" \
  -d "fb_exchange_token=$FB_PAGE_ACCESS_TOKEN"
```

Update `.env`, then:
```bash
docker compose restart n8n
```

Phase 11 will replace this with an automated cron + email alert.

## 4. Render-service incidents

```bash
docker compose logs --tail=200 render-service | grep -E '"level":"(warn|error)"'
```

Common:
- `remotion_bundle_failed` → JSX syntax error in templates. Rebuild image: `docker compose build render-service && docker compose up -d render-service`
- `render_failed` with `out of memory` → 16GB host pushed; restart Docker Desktop, reduce concurrent n8n executions
- `tts_failed` with `edge-tts exit -9` → killed (OOM). Same fix.

## 5. Restart playbook

| Action | Command |
|---|---|
| Restart n8n only (cron resync) | `docker compose restart n8n` |
| Rebuild + restart render-service | `docker compose build render-service && docker compose up -d render-service` |
| Full restart (idempotent) | `docker compose down && docker compose up -d` |
| **Nuclear** (wipes Postgres) | `docker compose down -v && docker compose up -d` — only if DB corrupt |

## 6. Backups

Daily Postgres dump (manual until Phase 11 automates):
```bash
mkdir -p backups
docker compose exec -T postgres pg_dump -U videofarm videofarm | gzip > "backups/$(date +%Y%m%d).sql.gz"
```

## 7. Cost watch

Run weekly:
```bash
bash scripts/check-pipeline-health.sh 7 | grep total_usd
```

Budget: ≤ $20/mo (~500k VND). Single quiz pipeline @ 1/day should consume ≤ $1.50/week.

## 8. Escalation

- 2 consecutive days failed → halt M1, investigate
- 3 days failed in 7 → M1 fail; back to planning
- Any account strike (YT/FB) → halt all pipelines, manual review, do NOT restart cron
