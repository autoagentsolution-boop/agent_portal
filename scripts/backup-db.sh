#!/usr/bin/env bash
# Daily Postgres backup with 14-day retention.
# Cron suggestion: 0 2 * * *  cd /path/to/repo && bash scripts/backup-db.sh

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-./backups}"
PG_USER="${POSTGRES_USER:-videofarm}"
PG_DB="${POSTGRES_DB:-videofarm}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
STAMP="$(date +%Y%m%d-%H%M%S)"

mkdir -p "$BACKUP_DIR"

OUT="$BACKUP_DIR/${PG_DB}-${STAMP}.sql.gz"

docker compose exec -T postgres pg_dump -U "$PG_USER" "$PG_DB" | gzip > "$OUT"

if [ ! -s "$OUT" ]; then
  echo "ERROR: backup file is empty, removing" >&2
  rm -f "$OUT"
  exit 1
fi

echo "Backup written: $OUT ($(du -h "$OUT" | cut -f1))"

# Retention
find "$BACKUP_DIR" -name "${PG_DB}-*.sql.gz" -mtime "+${RETENTION_DAYS}" -print -delete
