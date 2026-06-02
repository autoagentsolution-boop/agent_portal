#!/usr/bin/env bash
# check-pipeline-health.sh — daily status for the 7-day M1 observation window.
# Usage: bash scripts/check-pipeline-health.sh [days]
# Default lookback: 7 days. Run from any cwd; relies on docker compose project.

set -euo pipefail

DAYS="${1:-7}"
PG_USER="${POSTGRES_USER:-videofarm}"
PG_DB="${POSTGRES_DB:-videofarm}"

psql_exec() {
  docker compose exec -T postgres psql -U "$PG_USER" -d "$PG_DB" -P pager=off "$@"
}

echo "=== M1 health check (last ${DAYS}d) ==="
echo

echo "--- Recent video_job rows ---"
psql_exec -c "SELECT created_at::date AS day, pipeline, niche, status, cost_usd, error
              FROM video_job
              WHERE created_at > now() - interval '${DAYS} days'
              ORDER BY created_at DESC;"

echo
echo "--- Success rate by day ---"
psql_exec -c "SELECT created_at::date AS day,
                     COUNT(*) AS total,
                     COUNT(*) FILTER (WHERE status = 'published') AS published,
                     COUNT(*) FILTER (WHERE status = 'rendered') AS rendered_only,
                     COUNT(*) FILTER (WHERE status = 'failed') AS failed
              FROM video_job
              WHERE created_at > now() - interval '${DAYS} days'
              GROUP BY 1
              ORDER BY 1 DESC;"

echo
echo "--- Per-platform upload outcomes ---"
psql_exec -c "SELECT platform,
                     status,
                     COUNT(*) AS count
              FROM upload_target
              WHERE uploaded_at > now() - interval '${DAYS} days'
                 OR (uploaded_at IS NULL AND id IN (
                     SELECT id FROM upload_target ORDER BY id DESC LIMIT 50))
              GROUP BY 1, 2
              ORDER BY 1, 2;"

echo
echo "--- Latest errors (top 10) ---"
psql_exec -c "SELECT created_at, job_id, step, level, detail->>'error' AS error
              FROM run_log
              WHERE level = 'error'
                AND created_at > now() - interval '${DAYS} days'
              ORDER BY created_at DESC
              LIMIT 10;"

echo
echo "--- Total cost (last ${DAYS}d) ---"
psql_exec -c "SELECT COALESCE(SUM(cost_usd), 0) AS total_usd,
                     COUNT(*) AS jobs
              FROM video_job
              WHERE created_at > now() - interval '${DAYS} days';"

echo
echo "=== End of report ==="
