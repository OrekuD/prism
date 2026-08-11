---
title: Self-hosting guide
description: Deploy Prism on your own infrastructure with Docker Compose.
---

This guide covers running Prism self-hosted with the official Docker Compose
stack. One public origin serves the web app, the product API, and the
realtime WebSocket — no per-service URLs, no outbound network access at
runtime.

## Prerequisites

- A Linux host (or macOS for local testing) with Docker + Compose v2.
- A domain (optional for local testing: `http://localhost:3000` works).

## 1. Configure the stack

```sh
cp deploy/compose.env.example deploy/compose.env
```

Edit `deploy/compose.env` and replace every `CHANGE_ME` value:

```sh
# One-time generation (never reuse across instances):
openssl rand -hex 24   # JWT_SECRET_KEY
openssl rand -hex 24   # SETUP_TOKEN (first-boot owner setup)
openssl rand -hex 24   # POSTGRES_PASSWORD
```

Required variables:

| Variable | Purpose |
| --- | --- |
| `PUBLIC_URL` | The single public origin (e.g. `https://analytics.example.com`). Browser, API, and WebSocket all use it. |
| `JWT_SECRET_KEY` | Session/identity signing key (min 32 chars). |
| `SETUP_TOKEN` | Required by the one-time owner setup at `/setup`. |
| `POSTGRES_PASSWORD` | Product database password. |

Registration policy defaults to `SIGNUP_POLICY=disabled`; open it only
after the first owner exists, or use invites.

## 2. Start and create the owner

```sh
docker compose --env-file deploy/compose.env -f deploy/compose.yml up -d --build
```

Wait for readiness:

```sh
curl -fsS http://localhost:3000/health/live   # process
curl -fsS http://localhost:3000/health/ready  # database reachable
```

Then open `/setup` and create the owner account. You will be asked for the
`SETUP_TOKEN`. The owner becomes the instance administrator with a verified
email; the setup endpoint closes permanently afterwards.

## 3. Verify

- `/api/v1/config` reports `deploymentMode: "self-hosted"` and the
  configured instance name — no secrets.
- The analytics store (sqld) and object storage (local filesystem) live in
  named volumes: `pgdata`, `sqlddata`, `uploads`.

## Storage

`STORAGE_DRIVER=local` (default) writes avatars to the `uploads` volume and
serves them from `/files/*`. Swap to `s3` for any S3-compatible endpoint
(MinIO, R2, S3):

```
STORAGE_DRIVER=s3
STORAGE_S3_ENDPOINT=http://minio:9000
STORAGE_S3_REGION=us-east-1
STORAGE_S3_BUCKET=prism
STORAGE_S3_ACCESS_KEY_ID=...
STORAGE_S3_SECRET_ACCESS_KEY=...
STORAGE_PUBLIC_URL=https://minio.example.com/prism
```

`STORAGE_PUBLIC_URL` must be reachable by browsers (public bucket or a
proxied path). The bucket must allow `PUT`/`DELETE` with the configured
keys.

## Email

SMTP takes precedence over Resend:

```
MAIL_SMTP_HOST=smtp.example.com
MAIL_SMTP_PORT=587
MAIL_SMTP_SECURE=false
MAIL_SMTP_USER=...
MAIL_SMTP_PASS=...
MAIL_FROM=Prism <no-reply@example.com>
```

Without SMTP or Resend, no mail is sent and verification links never leave
the instance. Configure at least one before opening registration.

## TLS

Terminate TLS in front of the `web` service (port `PUBLIC_PORT`). Examples:

- Caddy: `analytics.example.com { reverse_proxy web:80 }` (automatic
  Let's Encrypt).
- Traefik with the Docker provider and an `acme` certificate resolver.
- A distribution nginx with certbot.

Set `PUBLIC_URL` to the `https://` origin so auth cookies, callbacks, and
email links use it.

## Upgrades

1. Take a backup (see below).
2. `docker compose --env-file deploy/compose.env -f deploy/compose.yml pull`
   (or rebuild with `up -d --build` for local images).
3. `docker compose --env-file deploy/compose.env -f deploy/compose.yml up -d`
   — the `migrate` service runs forward-only database migrations before the
   API starts; migrations never drop data.
4. Check `/health/live` and `/health/ready`, then the dashboard.
5. Rollback: re-run the previous image tag and restore the backup if the
   migration cannot be reverted — restore from the backup taken in step 1.

## Backups and restore

See the [backup and restore runbook](/guides/backup-restore/).

## Security notes

- The Compose network is `internal`: containers have no outbound access.
- The database port binds to `127.0.0.1` only.
- All brand assets, fonts, and JWKS material are served from the instance —
  no third-party asset hosts, no telemetry, no update pings.
- `db:reinstall` and drop-table commands are never available in the
  container images.
- Rate limiting is per-process; put the stack behind a shared limiter
  (proxy/Redis) for multi-replica deployments.
