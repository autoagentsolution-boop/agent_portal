#!/usr/bin/env bash
# Weekly secret-shaped string scan over run_log.detail. Prints job_id only on match.
# Cron suggestion: 0 6 * * 1  cd /path/to/repo && bash scripts/scan-secrets.sh

set -euo pipefail

PG_USER="${POSTGRES_USER:-videofarm}"
PG_DB="${POSTGRES_DB:-videofarm}"

PATTERNS='(sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{30,}|ghp_[A-Za-z0-9]{30,})'

MATCHES=$(
  docker compose exec -T postgres \
    psql -U "$PG_USER" -d "$PG_DB" -tAc \
    "SELECT job_id || '|' || step FROM run_log WHERE created_at > now() - interval '7 days' AND detail::text ~ '${PATTERNS}';"
)

if [ -z "$MATCHES" ]; then
  echo "[scan-secrets] clean"
  exit 0
fi

echo "[scan-secrets] SECRET-SHAPED STRINGS FOUND in run_log:" >&2
echo "$MATCHES" >&2
exit 2
