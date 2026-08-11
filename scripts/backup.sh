#!/usr/bin/env sh
# Prism self-hosted backup (task-6 section 5).
#
# Backs up the product PostgreSQL database (logical pg_dump), the uploads
# volume, and documents the analytics-store snapshot. Restore with
# scripts/restore.sh.
#
# Usage (from the repository root, with the stack running):
#   DATABASE_URL=postgres://prism:PASS@127.0.0.1:5432/prism \
#     COMPOSE_PROJECT_NAME=prism ./scripts/backup.sh [output-dir]
#
# For the analytics store (sqld), snapshot the named volume instead:
#   docker run --rm -v prism_sqlddata:/data -v "$PWD/backups":/out \
#     alpine tar czf /out/sqlddata-$(date +%F).tar.gz -C /data .
set -eu

OUT_DIR="${1:-backups}"
STAMP="$(date +%Y%m%d-%H%M%S)"
mkdir -p "$OUT_DIR"

echo "[prism-backup] dumping product database to $OUT_DIR/prism-$STAMP.dump"
pg_dump --no-owner --no-acl --format=custom \
  "${DATABASE_URL:?DATABASE_URL is required (host-side, e.g. postgres://user:pass@127.0.0.1:5432/prism)}" \
  > "$OUT_DIR/prism-$STAMP.dump"

if [ -n "${UPLOADS_VOLUME:-}" ]; then
  echo "[prism-backup] snapshotting uploads volume $UPLOADS_VOLUME"
  docker run --rm \
    -v "${UPLOADS_VOLUME}:/data:ro" \
    -v "$(pwd)/$OUT_DIR:/out" \
    alpine tar czf "/out/uploads-$STAMP.tar.gz" -C /data .
fi

echo "[prism-backup] done: $OUT_DIR/prism-$STAMP.dump"
echo "[prism-backup] remember to snapshot the analytics volume too (see script header)."
