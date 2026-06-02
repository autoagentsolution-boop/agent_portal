# Cold-Start Runbook

How to bring up the entire stack on a fresh machine from `git clone` to first uploaded video. Target: **≤ 2 hours end-to-end**.

This doubles as the M2 verification procedure. After every major refactor, run this end-to-end on a clean Docker volume to catch hidden manual steps.

## 0. Prerequisites (host)

- Docker Desktop ≥ 4.30 (running, with WSL2 backend on Windows)
- Node.js ≥ 20 (only for local `db migrate` + `npm run status`)
- Git
- ~10 GB free disk (Postgres + Remotion Chromium + Docker images)

## 1. Clone + env (5 min)

```bash
git clone <repo-url> videofarm
cd videofarm
cp .env.example .env
chmod 600 .env
```

Fill `.env`:
- `POSTGRES_PASSWORD` — any strong random string
- `N8N_BASIC_AUTH_PASSWORD` — any strong random string
- `RENDER_SECRET` — any 32+ char random string
- `GEMINI_API_KEY` — from <https://aistudio.google.com/apikey>
- `PEXELS_API_KEY` — from <https://www.pexels.com/api/>

(YT and FB tokens come later, after OAuth setup.)

## 2. Bring up Postgres + n8n (5 min)

```bash
docker compose up -d postgres n8n
docker compose ps    # both should be healthy after ~30s
```

## 3. Apply DB migration (2 min)

```bash
npm --prefix db install
DATABASE_URL="postgresql://videofarm:${POSTGRES_PASSWORD}@localhost:5432/videofarm" \
  npm --prefix db run migrate:deploy
```

Verify:
```bash
docker compose exec postgres psql -U videofarm -d videofarm -c '\dt'
# expect: asset, run_log, upload_target, video_job
```

## 4. Build + start render-service (15–25 min, first-time only)

The image bake includes Chromium runtime libs + Python + edge-tts pip install + Remotion Chrome Headless Shell download.

```bash
docker compose --profile render up -d --build render-service
docker compose --profile render logs -f render-service
# wait for: "remotion_bundle_ready" and "render_service_listening"
```

Smoke:
```bash
curl http://localhost:7000/health
# {"ok":true,"bundleReady":false}   (false is OK — bundle warms in background)
```

## 5. OAuth setup (30–40 min) — **the unavoidable manual step**

Follow [`oauth-setup.md`](oauth-setup.md) end-to-end:
- YouTube Data API + OAuth client + n8n credential
- Facebook app + long-lived Page token + `.env` update
- n8n Postgres credential

After OAuth setup:
```bash
docker compose restart n8n     # picks up FB token from .env
```

## 6. Import workflows (5 min)

```bash
for f in quiz-pipeline upload-to-platforms news-comic-pipeline life-hacks-pipeline fb-token-refresh; do
  docker compose cp "n8n-workflows/${f}.json" "n8n:/tmp/${f}.json"
  docker compose exec n8n n8n import:workflow --input="/tmp/${f}.json"
done
```

In n8n UI (`http://localhost:5678`):
1. Open each workflow → re-bind Postgres / YouTube / Facebook credentials (n8n drops credential refs on import)
2. Save each workflow

## 7. Manual trigger per pipeline (15 min — one video each)

In n8n UI for each pipeline workflow:
- Click **Execute workflow** (manual trigger)
- Wait for completion (quiz ~2 min, life hacks ~3 min, news-comic ~5 min)
- Check Postgres: `bash scripts/check-pipeline-health.sh 1`
- Check actual platforms: visit the URLs in `upload_target.url`

## 8. Activate cron (1 min)

For each pipeline workflow in n8n UI → toggle **Active**.

```bash
docker compose restart n8n   # ensure crons load
```

## 9. Set up host crons (5 min)

Add to host crontab:
```cron
0 2 * * *  cd /path/to/videofarm && bash scripts/backup-db.sh >> /var/log/videofarm-backup.log 2>&1
0 6 * * 1  cd /path/to/videofarm && bash scripts/scan-secrets.sh >> /var/log/videofarm-secrets.log 2>&1
```

## 10. Smoke verify (5 min)

```bash
bash scripts/check-pipeline-health.sh 1
npx tsx scripts/status.ts --jobs
```

Should show recent successful jobs across pipelines.

---

## Time budget summary

| Step | Estimate |
|---|---|
| Clone + env | 5 min |
| Postgres + n8n | 5 min |
| Migration | 2 min |
| Render-service build | 15-25 min (first time) |
| OAuth setup | 30-40 min |
| Import workflows | 5 min |
| Manual triggers ×3 | 15 min |
| Activate + crons | 5 min |
| Verify | 5 min |
| **Total** | **~90 min** |

## Common gotchas (found during M2 cold-start)

| Symptom | Cause | Fix |
|---|---|---|
| `docker compose --profile render up` hangs at "remotion_bundle_start" | First-time Chromium Shell download (~250MB) | Just wait; subsequent boots are <30s |
| n8n imports lose credentials | Expected n8n behavior on import | Re-bind in UI per workflow |
| FB token rejected on first upload | App in "Test" mode + test user not added | Settings → Roles → add the Page owner as test user |
| YT upload says "channel not found" | OAuth granted on wrong Google account | Re-authorize in n8n credential, sign in to correct account |
| Postgres `permission denied for schema public` | n8n connected before init migration ran | Re-run §3, then `docker compose restart n8n` |
| `edge-tts: command not found` | Python venv didn't symlink (Dockerfile edge case) | `docker compose exec render-service ls /opt/edge-tts/bin/` — repair symlink if missing |
| Render fails with `OOM killed` | Multiple workflows triggered concurrently | render-service queue mutex should prevent this; if persistent, lower n8n concurrency env |

## When to re-run cold-start

- After any change to `docker-compose.yml` or `Dockerfile`
- After Prisma schema migration
- Before sharing the repo with anyone else
- Quarterly (catches doc drift)
