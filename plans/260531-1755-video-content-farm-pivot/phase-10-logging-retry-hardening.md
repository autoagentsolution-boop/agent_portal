# Phase 10 — Logging UI + Retry Hardening

## Context Links
- Plan: [plan.md](plan.md)
- Previous: [phase-09](phase-09-multi-voice-routing.md)

## Overview
- **Priority:** Medium (operations layer cho long-running)
- **Status:** pending
- **Effort:** 1.5 days
- **Brief:** CLI status command (`scripts/status.ts`) query Postgres summary 7/30 ngày. Retry policy chuẩn cho tất cả external calls. Cost cap alert. Daily DB backup cron.

## Key Insights
- KHÔNG cần web UI — CLI đủ cho personal use, save weeks dev time
- Retry là quan trọng nhất: 80% failure tự fix với 1 retry
- Cost cap = circuit breaker: nếu hôm nay đã chi > $5, pause cron tự động

## Requirements

### Functional
- `scripts/status.ts` CLI:
  ```
  npm run status              # last 24h summary
  npm run status -- --week    # 7-day summary by pipeline
  npm run status -- --jobs    # last 20 jobs with status + URLs
  npm run status -- --cost    # cost breakdown by provider
  npm run status -- --logs <jobId>   # tail run_log cho 1 job
  ```
- Retry wrapper utility in render-service:
  - `withRetry(fn, { attempts: 3, baseMs: 1000, factor: 2, retryOn: status_codes })`
  - Used by: Gemini, Nano Banana, GCloud TTS, Edge TTS, Pexels, YT, FB
  - Idempotency: only retry on 5xx, 429, network errors. KHÔNG retry 4xx
- Cost cap:
  - Daily budget config `MAX_DAILY_COST_USD=2.00`
  - `video_job.cost_usd` running sum
  - Pre-flight check trong workflow: if today's spend > cap, abort + log
- Daily DB backup: cron 02:00 `pg_dump videofarm | gzip > backup/videofarm-{date}.sql.gz`, keep 14 days
- run_log scan: weekly grep cho secret-shaped strings (sk-*, Bearer *) → alert if found

## Architecture

```
scripts/status.ts → psql queries → format ascii table to stdout

render-service/src/util/retry.ts → reused by all integrations
render-service/src/util/cost-cap.ts → /preflight endpoint n8n calls before expensive step

cron-host (or docker-compose service):
  - 02:00 pg_dump
  - 04:00 cleanup old backups (>14 days)
  - 06:00 weekly secret-scan (run_log grep)
```

## Related Code Files
- **Create:** `scripts/status.ts`, `scripts/backup-db.sh`, `scripts/scan-secrets.sh`
- **Create:** `render-service/src/util/retry.ts`, `cost-cap.ts`
- **Modify:** All integration wrappers (`nano-banana.ts`, `gcloud.ts`, `pexels.ts`, n8n HTTP nodes) → use retry wrapper
- **Modify:** n8n workflows — add pre-flight cost check node before expensive image gen step
- **Modify:** `docker-compose.yml` — add `cron` service hoặc dùng host cron

## Implementation Steps
1. `retry.ts`:
   ```ts
   export async function withRetry<T>(fn: () => Promise<T>, opts) {
     const { attempts = 3, baseMs = 1000, factor = 2, retryOn = [500,502,503,504,429] } = opts;
     for (let i = 0; i < attempts; i++) {
       try { return await fn(); }
       catch (e) {
         const status = e.response?.status;
         if (i === attempts - 1 || (status && !retryOn.includes(status))) throw e;
         await sleep(baseMs * Math.pow(factor, i));
       }
     }
   }
   ```
2. Wrap mọi integration call với retry
3. `cost-cap.ts`:
   ```ts
   POST /preflight/cost
   Body: { estimatedCostUsd }
   - SELECT SUM(cost_usd) FROM video_job WHERE created_at::date = current_date
   - if sum + estimated > MAX_DAILY_COST_USD → return { ok: false }
   - else return { ok: true }
   ```
4. n8n workflows: add HTTP node `/preflight/cost` before Nano Banana step. If `ok: false`, abort + log + skip remaining
5. `scripts/status.ts` (Node script, prisma client):
   ```ts
   import { PrismaClient } from '@prisma/client';
   const db = new PrismaClient();
   if (flag === '--week') {
     const rows = await db.$queryRaw`
       SELECT pipeline, COUNT(*) total, COUNT(*) FILTER (WHERE status='published') ok,
              SUM(cost_usd) cost
       FROM video_job WHERE created_at > now() - interval '7 days'
       GROUP BY pipeline
     `;
     console.table(rows);
   }
   // ... other flags
   ```
6. `backup-db.sh`:
   ```bash
   #!/usr/bin/env bash
   set -e
   docker compose exec -T postgres pg_dump -U videofarm videofarm | gzip > backup/videofarm-$(date +%Y%m%d).sql.gz
   find backup -name 'videofarm-*.sql.gz' -mtime +14 -delete
   ```
7. `scan-secrets.sh`:
   ```bash
   psql -tAc "SELECT detail::text FROM run_log WHERE created_at > now() - interval '7 days'" \
     | grep -E '(sk-[A-Za-z0-9]{20,}|Bearer [A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16})' \
     && echo "SECRET LEAK DETECTED" || echo "clean"
   ```
8. Schedule cron (host or docker `ofelia` scheduler)

## Todo List
- [ ] `retry.ts` utility + wrap integrations
- [ ] `cost-cap.ts` /preflight endpoint
- [ ] n8n workflows: add pre-flight cost check nodes
- [ ] `scripts/status.ts` với 4 flags
- [ ] `scripts/backup-db.sh` daily cron
- [ ] `scripts/scan-secrets.sh` weekly cron
- [ ] Test cost cap: force `MAX_DAILY_COST_USD=0.01` → next workflow aborts
- [ ] Test retry: kill Gemini midway → workflow retries 3x → fail gracefully
- [ ] Verify backup file rotation (14 day window)

## Success Criteria
- `npm run status -- --week` returns coherent summary trong < 2s
- Inject 502 simulator → integration auto retry, eventually succeeds
- Cost cap triggers: simulated overspend → workflow aborts + log clear message
- Backup file present in `backup/` mỗi ngày, old ones cleaned

## Risk Assessment
- **Risk:** Retry storm khi upstream down → **Mitigation:** Max 3 attempts, exponential backoff (1s, 2s, 4s)
- **Risk:** Cost cap too tight → workflows fail unnecessarily → **Mitigation:** Default $2/day = 60/mo headroom, configurable env var
- **Risk:** Backup file fills disk → **Mitigation:** 14-day window + gzip compression (typical DB < 50MB compressed for this workload)

## Security Considerations
- Backup files contain Gemini/FB tokens? — NO, tokens trong n8n credential store (encrypted SQLite), not main DB
- secret-scan output: nếu detect, KHÔNG print the actual string in alert (just job_id + line offset)

## Next Steps
→ Phase 11: FB token refresh + cold-start verification + DEMO_SCRIPT (M2 milestone)
