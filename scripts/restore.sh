#!/usr/bin/env sh
# Prism self-hosted restore (task-6 section 5).
#
# Restores the product PostgreSQL database from a pg_dump custom-format
# file produced by scripts/backup.sh, and restores the uploads volume.
#
# Usage (from the repository root, with the stack running):
#   DATABASE_URL=postgres://prism:PASS@127.0.0.1:5432/prism \
#     ./scripts/restore.sh backups/prism-20260101-000000.dump
#
# WARNING: this overwrites the target database. Take a fresh backup first.
set -eu

DUMP_FILE="${1:?usage: restore.sh <dump-file>}"
[ -f "$DUMP_FILE" ] || { echo "[prism-restore] $DUMP_FILE not found"; exit 1; }

echo "[prism-restore] restoring $DUMP_FILE into ${DATABASE_URL:?DATABASE_URL is required}"
pg_restore --no-owner --no-acl --clean --if-exists \
  --dbname "$DATABASE_URL" "$DUMP_FILE"

if [ -n "${UPLOADS_VOLUME:-}" ] && [ -n "${UPLOADS_ARCHIVE:-}" ]; then
  echo "[prism-restore] restoring uploads volume $UPLOADS_VOLUME from $UPLOADS_ARCHIVE"
  docker run --rm \
    -v "${UPLOADS_VOLUME}:/data" \
    -v "$(pwd)/$(dirname "$UPLOADS_ARCHIVE"):/in:ro" \
    alpine sh -c "rm -rf /data/* && tar xzf /in/$(basename "$UPLOADS_ARCHIVE") -C /data"
fi

echo "[prism-restore] done. Restart the stack: docker compose -f deploy/compose.yml restart api analytics"
