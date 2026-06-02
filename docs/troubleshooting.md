# Troubleshooting

Quick-reference table. For pipeline-specific issues see [`runbook-quiz-pipeline.md`](runbook-quiz-pipeline.md). For first-time setup, [`runbook-cold-start.md`](runbook-cold-start.md).

| Symptom | Likely cause | First fix |
|---|---|---|
| **Video không lên YouTube** | OAuth token revoked or scope changed | n8n → Credentials → YouTube OAuth2 → **Reconnect** → re-grant scopes |
| **YouTube upload 403 quotaExceeded** | Daily quota (10K units) hit | Wait until midnight Pacific; reduce volume; request quota raise |
| **FB upload 401 OAuth** | Page token expired (60-day silent) | Manual trigger `fb-token-refresh` workflow, OR follow §2 of `oauth-setup.md` to regenerate |
| **FB upload 200 but post not visible** | Page in Development mode | Facebook app → App Review → switch to Live (no review needed for own Page) |
| **n8n cron không trigger** | n8n container restarted after schedule time | `docker compose restart n8n`; expected — no catchup |
| **Same niche back-to-back days** | n8n clock drifted OR weekday calc wrong in code node | Check container time: `docker compose exec n8n date`; restart if drifted |
| **Render-service timeout (5xx after 5 min)** | Remotion bundle stuck OR Chromium OOM | `docker compose logs --tail=200 render-service`; restart: `docker compose restart render-service` |
| **`remotion_bundle_failed`** | JSX/TS error in templates after recent edit | `docker compose build render-service` then `up -d` — bind-mount is intentionally off |
| **`edge-tts exit -9`** | Subprocess killed (OOM) | Reduce render-service memory pressure; check no other heavy container co-running |
| **`gcloud_no_audio_content`** | Service account lacks TTS API permission | GCP IAM → grant `roles/cloudtts.synthesizer` to SA |
| **GCloud TTS falls back to Edge every call** | `GOOGLE_TTS_CREDENTIALS_BASE64` not set OR malformed JSON | `docker compose exec render-service env \| grep GOOGLE`; verify base64 decodes to valid JSON |
| **Gemini 429** | Free tier 1500 RPD hit (unlikely at our volume) | Upgrade to paid; or check for accidental loops in workflows |
| **Gemini schema invalid** | LLM occasionally returns markdown fence | Workflow's parser already strips ```json fences; if persistent, lower temperature |
| **Nano Banana 400 prompt blocked** | Safety filter on character_setup or panel prompt | Refine `character_setup` to avoid age/ethnicity details; rerun pipeline |
| **Cost cap aborts workflow mid-run** | Day's spend exceeded `MAX_DAILY_COST_USD` | Check `npx tsx scripts/status.ts --cost`; raise cap if intentional |
| **Postgres `permission denied for schema public`** | Migration not run | `npm --prefix db run migrate:deploy` |
| **`pg_isready` healthcheck fails** | Volume corrupt OR password mismatch | `docker compose down -v` (destructive); restart from cold-start runbook |
| **Postgres BIGINT overflow (asset.bytes)** | n/a at our scale (1TB before overflow) | — |
| **`npm run status` empty tables** | No jobs yet, OR Prisma client stale | Run a workflow; or `npm --prefix db run generate` to regenerate client |
| **Backup script fails silently** | Docker compose project name mismatch | Set `COMPOSE_PROJECT_NAME` env or run from repo root |
| **`scan-secrets.sh` false positive** | Detail JSON contains long base64 image fragment | Tighten regex; or ack and continue |
| **n8n UI shows credential warnings after import** | Imports drop credential refs | Re-bind in workflow editor — expected, document during cold-start |
| **`/render` returns 401** | `RENDER_SECRET` not set on caller side | Verify n8n workflow uses `{{$env.RENDER_SECRET}}` header and matches `.env` |
| **`Could not resolve dependency` on `npm install`** | Node version too old | Need Node ≥ 20 (Remotion req); `node --version` to confirm |
| **`docker compose up` says image not found for render-service** | Built with no profile flag | `docker compose --profile render up -d render-service` |
| **Run-log fills disk** | run_log has no retention | Add to backup-db.sh: `DELETE FROM run_log WHERE created_at < now() - interval '60 days'` — TODO post-MVP |

## Diagnostic commands cheat-sheet

```bash
# Status across windows
npx tsx scripts/status.ts                 # last 24h
npx tsx scripts/status.ts --week          # 7d by pipeline
npx tsx scripts/status.ts --jobs          # last 20 jobs + URLs
npx tsx scripts/status.ts --cost          # cost breakdown
npx tsx scripts/status.ts --logs <jobId>  # full log for a job

# Quick health snapshot
bash scripts/check-pipeline-health.sh 1   # last day
bash scripts/check-pipeline-health.sh 7   # last week

# Container vitals
docker compose ps
docker compose logs --tail=200 render-service
docker compose logs --tail=200 n8n

# Postgres direct
docker compose exec postgres psql -U videofarm -d videofarm
```
