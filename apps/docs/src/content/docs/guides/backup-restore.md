---
title: Backup and restore
description: Back up and restore a self-hosted Prism deployment.
---

A self-hosted Prism deployment keeps state in three places:

| Store | Location | Recommended backup |
| --- | --- | --- |
| Product database (PostgreSQL) | `pgdata` volume | logical `pg_dump` |
| Analytics store (sqld/libSQL) | `sqlddata` volume | volume snapshot |
| Uploads (local driver) | `uploads` volume | volume snapshot |

Deployment secrets (`deploy/compose.env`) are not stored in the stack;
keep them in your secret manager and back them up with it.

## Product database

Use the included script (requires `pg_dump` on the host, or run it through
the `db` container):

```sh
DATABASE_URL=postgres://prism:PASSWORD@127.0.0.1:5432/prism \
  ./scripts/backup.sh backups/
```

This produces a custom-format dump: `backups/prism-<timestamp>.dump`.
Restore (overwrites the target database — take a fresh backup first):

```sh
DATABASE_URL=postgres://prism:PASSWORD@127.0.0.1:5432/prism \
  ./scripts/restore.sh backups/prism-20260101-120000.dump
docker compose --env-file deploy/compose.env -f deploy/compose.yml restart api analytics
```

`pg_restore --clean --if-exists` re-creates the schema; the `migrate`
service applies any newer migrations on the next start.

## Analytics store and uploads

Snapshot the named volumes (the sqld service should be stopped or quiesced
for a consistent analytics snapshot):

```sh
docker compose --env-file deploy/compose.env -f deploy/compose.yml stop sqld
docker run --rm -v prism_sqlddata:/data -v "$PWD/backups":/out \
  alpine tar czf /out/sqlddata-$(date +%F).tar.gz -C /data .
docker run --rm -v prism_uploads:/data -v "$PWD/backups":/out \
  alpine tar czf /out/uploads-$(date +%F).tar.gz -C /data .
docker compose --env-file deploy/compose.env -f deploy/compose.yml start sqld
```

Restore by replacing the volume contents before starting the services.

## Retention

Choose a retention window that matches your analytics commitments (e.g.
keep daily dumps for 30 days and monthly dumps for a year). Off-site
copies (object storage, another host) protect against host loss. Test
restores regularly — a backup that has never been restored is an
assumption.

## Upgrade checklist

1. Backup all three stores + the env file.
2. Review the release notes for breaking changes and migration notes.
3. Pull/rebuild images.
4. `up -d` — the `migrate` service runs before the API starts.
5. Verify `/health/live`, `/health/ready`, and a signed-in dashboard.
6. Keep the previous image tag and the backup for rollback.
