#!/usr/bin/env bash
# Start local sqld backed by a persistent file (no Docker)
# Turso Cloud stays untouched for prod — this is dev only.
set -euo pipefail
DB_PATH="$HOME/Desktop/Oreku/code/prep/projects/prism/apps/analytics-api/data/sqld"
mkdir -p "$DB_PATH"
echo "Starting sqld on 127.0.0.1:5001 with $DB_PATH"
exec /Users/david/.turso/sqld --db-path "$DB_PATH" --http-listen-addr 127.0.0.1:5001 --no-welcome
