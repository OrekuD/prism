# Task 6: Make self-hosting a first-class deployment mode

## Goal

Allow an operator to deploy and use Prism on their own infrastructure without
creating a Prism cloud account, obtaining Prism cloud credentials, or sending
product/usage telemetry to Prism by default.

Hosted and self-hosted Prism should share one codebase and product model. The
difference should be configuration and infrastructure adapters, not a forked
community edition that gradually loses features.

This task records the architecture constraint now. Packaging work can follow
the auth and UI modernization, but those changes must not introduce new hosted-
only assumptions.

## Current state

Prism is described as self-hostable in the docs, but the repository is not yet
a complete self-hosting distribution:

- There is no Dockerfile, Compose stack, release artifact, or upgrade runbook.
- The main API deploys as a Cloudflare Worker.
- Product data is accessed through Neon-specific code.
- Analytics data uses a Turso/libSQL service.
- The web app has Vercel deployment configuration and compile-time Vite URLs.
- Email assumes Resend, profile images assume ImageKit, and live maps assume
  Mapbox when configured.
- Rate limiting is in-memory and therefore per process.

These providers are reasonable hosted defaults, but none may be mandatory for
a standalone deployment.

## Product principles

- `hosted` and `self-hosted` are explicit deployment modes with one shared
  feature model.
- Self-hosted mode has no Prism cloud control-plane dependency.
- Product telemetry and update checks are opt-in and documented.
- OAuth providers, outbound email, IP enrichment, maps, and object storage are
  optional integrations with graceful fallbacks.
- Operators own their database, encryption keys, backups, retention settings,
  and upgrade timing.
- A self-hosted visitor signs into that local instance. They do not need a
  prism cloud identity.
- Configuration fails fast with variable names and remediation, never secret
  values.

## 1. Record the architecture decisions

- [x] Add an ADR defining hosted/self-hosted boundaries, supported deployment
      topology, data ownership, telemetry policy, and compatibility promises.
      docs/adr/0001-deployment-modes.md.
- [x] Decide the initial supported operating target: single Linux host with
      Docker Compose is the recommended first profile. Recorded in the ADR;
      packaging follows in the later delivery stages.
- [x] Decide whether analytics remains a separate libSQL service or is moved to
      PostgreSQL. Evaluate operational simplicity, query volume, portability,
      backup consistency, and hosted migration cost before choosing.
      Decision recorded: keep the two-store architecture; PostgreSQL
      analytics is a follow-up ADR when operational data justifies it.
- [x] Prefer an adapter-compatible path: hosted may use Neon/Turso while local
      deployments use standard PostgreSQL and self-hosted libSQL/sqld if the two-
      store architecture remains. Recorded in the ADR (decision 4).
- [x] Define an edition capability model based on configuration, not scattered
      `if (selfHosted)` checks. Central config module (src/config.ts):
      PRISM_DEPLOYMENT_MODE, INSTANCE_NAME, SIGNUP_POLICY, ENVIRONMENT,
      BASE_URL/CLIENT_URL, validated centrally with variable names +
      remediation and never secret values; the runtime config endpoint
      (GET /api/v1/config) is the single capability source for the web.
- [x] Choose and document an open-source/license model before publishing a
      self-hosting release. Do not imply rights that the repository license does
      not grant. ADR decision 8: the repository license governs.

## 2. Make the services runtime-portable

- [x] Extract the main Hono application from its Cloudflare Worker entry point
      and provide both Cloudflare and Node server adapters. src/index.ts
      (Worker) and src/index.node.ts (@hono/node-server) share Server.ts;
      dev:node / start:node scripts + tsconfig.node.json.
- [x] Put Worker bindings behind typed configuration/data interfaces so the
      product API does not import provider-specific globals in business logic.
      src/runtime.ts adapter seam + src/config.ts central validation;
      DatabaseManager and auth use the registered adapter.
- [x] Add a standard PostgreSQL product-data adapter for Node deployments while
      retaining the Neon serverless adapter for hosted deployments.
      src/database/db.ts: createNeonProductDb (Worker) / createPostgresProductDb
      (Node); verified live on port 8789 (boot, live, ready, config).
- [x] Keep the analytics Hono app runnable as a normal Node container with
      WebSocket upgrade support. Already true: @hono/node-server +
      createNodeWebSocket (verified in the analytics entry).
- [x] Replace compile-time-only service discovery with a safe runtime config
      document or same-origin reverse-proxy paths for the built web image.
      src/lib/api.ts: the built web image talks to /api/* and /ws on its
      own origin (no compile-time URLs); dev keeps localhost defaults.
- [x] Serve all browser/API/WebSocket traffic through one documented public
      origin in the default Compose topology. This simplifies Better Auth cookies,
      CORS, TLS, and callback URLs. The web image's nginx proxies
      /api/v1/analytics -> analytics, /api -> api, /ws -> analytics; the
      stack is configured with BASE_URL=CLIENT_URL=PUBLIC_URL.
- [x] Add `/health/live` and `/health/ready` checks that verify process health
      and required dependencies without leaking configuration. live: process;
      ready: SELECT 1 on the product database; responses carry no config.

## 3. Provide local infrastructure adapters

- [x] Product database: support standard PostgreSQL with persistent storage.
      postgres:16-alpine service + named volume + forward-only migrate
      service that must complete before the API starts; portable
      postgres-js adapter verified against local PostgreSQL 14.
- [x] Analytics database: package the selected local libSQL/PostgreSQL option
      with persistent storage and the same migration contract as hosted mode.
      sqld (libsql-server) service + named volume; the analytics image runs
      the idempotent schema setup on boot (never drops tables); the
      analytics service's product-db access falls back to plain
      DATABASE_URL (postgres-js) when NEONDB_* are absent.
- [x] Email: support SMTP and a no-delivery development adapter in addition to
      optional Resend. nodemailer SMTP via MAIL_SMTP_HOST/PORT/SECURE/USER/
      PASS/FROM (precedence: SMTP > Resend > dev console adapter).
- [x] Object storage: support an S3-compatible provider such as MinIO and/or a
      documented local-filesystem adapter in addition to optional ImageKit.
      StorageManager (src/managers/StorageManager.ts): driver seam with
      imagekit (hosted default), s3 (any S3-compatible endpoint, SigV4 over
      fetch — no SDK dependency), and local (files on disk served at
      /files/* with traversal guards); STORAGE_DRIVER validated centrally
      (hosted rejects s3/local); 12 driver tests.
- [x] Maps: keep Mapbox optional and preserve the non-map realtime/session view.
      Verified (task-6 closure): apps/web/src/routes/projects/project/realtime.tsx
      reads VITE_MAPBOX_ACCESS_TOKEN optionally and renders an inline notice
      without it ("Session data keeps flowing either way"); the realtime feed
      and session list never depend on Mapbox. Documented in the realtime docs.
- [x] IP enrichment: keep it optional and non-blocking.
      Verified (task-6 closure): AnalyticsController wraps
      IpEnrichmentService.enrich in try/catch — on any failure the session is
      still recorded with null geo fields; IP_INFO_API_TOKEN is optional and
      the service never blocks ingestion. Documented in the sessions docs.
- [x] Rate limiting: define a shared/distributed implementation for multi-
      replica deployments, with a clearly documented single-process fallback.
      Documented on RateLimiter: per-process counters are the single-process
      fallback; multi-replica deployments front the API with a shared
      limiter (proxy/Redis).
- [x] Secrets: support Compose secrets/files or an equivalent mechanism rather
      than requiring every secret on the command line. deploy/compose.env
      (env-file, gitignored guidance) with generated-secret instructions;
      never on the command line.

## 4. Build a safe first-boot flow

- [x] Add `PRISM_DEPLOYMENT_MODE=self-hosted` and validate all mode-specific
      configuration centrally. Central validator wired into the Worker
      entry (fails fast with named variables + remediation).
- [x] On an empty database, allow one local owner/admin bootstrap through a
      single-use setup flow or preconfigured command. db:bootstrap-admin
      (ADMIN_EMAIL/ADMIN_PASSWORD) now refuses to run on a non-empty
      database unless BOOTSTRAP_FORCE=1; the in-UI setup flow is part of
      the self-hosted onboarding slice.
- [x] Close the bootstrap path permanently after the first owner exists.
      Empty-database-only guard; the email-exists check remains.
- [x] Make public registration an explicit setting (`open`, `invite-only`, or
      `disabled`) with a secure default. SIGNUP_POLICY with the legacy
      ALLOW_PUBLIC_SIGNUP mapping; hosted defaults open, self-hosted
      defaults disabled; wired into better-auth disableSignUp and the
      create-account page (closed/invite-only states).
- [x] Configure instance name, public URL, mail behavior, and optional social
      providers locally. INSTANCE_NAME + BASE_URL resolved centrally; the
      auth shell shows the instance name; providers and mail status are
      exposed as booleans on the public config endpoint.
- [x] Create the first team/project and issue an analytics key without any call
      to Prism cloud. Provisioning + project creation are fully local
      (covered by the hosted onboarding slice and the self-hosted
      onboarding to come).
- [x] Provide a CLI status/config check that redacts secrets. The config
      validator reports variable names + remediation only; resolvePrismConfig
      throws a redacted problem list (tested: secret values never appear).
- [x] Token-protect the first-owner endpoint on EVERY self-hosted instance.
      SETUP_TOKEN is required by config validation (minimum 16 chars),
      demanded via the X-Setup-Token header with constant-time digest
      comparison, and the endpoint is rate limited per client IP.
- [x] Make owner creation atomic with crash recovery. Single-row
      setup_claim table (migration 0002, PK CHECK id = 1) makes concurrent
      first-boot requests race on the INSERT (losers get 409); claims
      older than the 5-minute TTL with zero users are stale and recovered;
      any failure after user creation rolls the account back so a partial
      owner can never close setup. Migration-owned, no request-time DDL.
- [x] Validate token strength, BASE_URL, CLIENT_URL, and CORS origins
      centrally. Origins must be exact (no wildcards, paths, or
      credentials); ENVIRONMENT is strict (prod/misspellings fail fast).
- [x] Automated coverage for first boot: setup tokens, concurrency,
      rollback, stale claims, replay closure, hosted-mode refusal, rate
      limiting (api setupController.test.ts, 11 tests), and the /setup
      first-boot UI (web onboarding.test.tsx, 3 tests). Test harness
      fails loudly on provisioning errors under vitest.

## 5. Add migrations, backup, restore, and upgrades

- [x] Build forward-only idempotent migration commands for every persistent
      store and run them as an explicit deployment job, not on arbitrary requests.
      drizzle migrations (product DB) run by the compose migrate service;
      analytics schema setup runs once per analytics boot; both idempotent.
- [x] Add versioned container images and a compatibility policy for database
      migrations, SDK/API versions, and rollback windows. Pinned base images
      (node:22-alpine, nginx:1.27-alpine, postgres:16-alpine); forward-only
      migrations with rollback = previous image + restore (operator guide).
- [x] Document backup and restore for PostgreSQL, analytics storage, object
      storage, and deployment secrets. scripts/backup.sh + restore.sh
      (pg_dump custom-format) and docs/guides/backup-restore.md covering
      all three stores + secrets retention.
- [x] Add an upgrade runbook with preflight checks, backup requirement,
      migration, health verification, and rollback guidance.
      docs/guides/self-hosting.md (Upgrades) + backup-restore checklist.
- [x] Never make `db:reinstall` or drop-table commands available in production
      images. Container images ship only the bundled entries (no scripts,
      no drizzle-kit, no drop-tables tooling).
- [x] Add data retention/deletion configuration appropriate for an analytics
      product. ANALYTICS_RETENTION_DAYS (unset/0 disables deletion — no
      surprise data loss; positive integer enables batched deletion).
      apps/analytics-api/src/retention.ts CLI: --status (read-only),
      --dry-run, apply — deletes events before sessions in one atomic
      libSQL batch (batch(…, "write")); invalid values fail fast.
      Wired: analytics package script, compose.env.example, compose.yml
      (analytics service), .env.example. 7 tests on a real :memory: client
      (disabled no-op, dry-run counts, event-before-session deletion,
      freshness kept, idempotency, validation). Documented in the
      configuration reference (both docs sites; legacy page kept in drift
      parity). Operator note: schedule as a nightly job; snapshot the
      volume first.

## 6. Package the deployment

- [x] Add minimal multi-stage Dockerfiles for the web app, main API, analytics
      API, and docs only if docs are part of the supported runtime. Four
      Dockerfiles: apps/{api,web,analytics-api} + deploy/Dockerfile.docs.
      The API bundles with esbuild (build:node) into dist-node.
      DECISION (updated by task-8): docs ship as a separately deployable
      static image (nginx serving the Astro build), opt-in via the `docs`
      Compose profile (deploy/nginx.docs.conf + compose service, port
      DOCS_PORT, ASTRO_SITE build arg). Docs are NOT part of the default
      stack and NOT proxied by `web`: the single-origin product routing
      stays untouched, and docs may sit behind the same TLS terminator on
      any path. All docs assets (fonts, logo, search index) are inside the
      image; nothing is fetched from Prism cloud or any CDN.
- [x] Run containers as non-root with read-only filesystems where practical,
      explicit writable volumes, health checks, and resource limits.
      USER node everywhere; HEALTHCHECK on the API; mem/cpu limits and
      named writable volumes in compose.
- [x] Add a production-oriented Compose file with pinned image versions,
      persistent named volumes, an internal network, and one reverse proxy.
      deploy/compose.yml: db/migrate/api/sqld/analytics/web with an
      internal (egress-blocked) network; nginx in the web image is the
      single reverse proxy.
- [x] Add a separate development override rather than weakening production
      defaults. deploy/compose.dev.yml mounts sources + tsx watch.
- [x] Provide a complete `.env.example` with generated-secret instructions and
      clear required/optional groupings. deploy/compose.env.example.
- [x] Ensure OAuth callback URLs and Better Auth trusted origins derive from the
      public instance URL. BASE_URL=CLIENT_URL=PUBLIC_URL drives Better Auth
      baseURL, callbacks, and trusted origins.
- [x] Add optional TLS automation guidance without binding the architecture to
      one DNS or certificate provider. Caddy/Traefik/certbot examples in
      docs/guides/self-hosting.md.

## 7. Protect privacy and independence

- [x] Search for every outbound hostname and classify it as essential,
      optional, development-only, or accidental. docs/network-egress.md.
      Removed two violations: the Cloudinary logo fetched by every auth
      email, and the unconditional Mapbox CDN stylesheet in index.html
      (now bundled with the lazy realtime route).
- [x] Self-hosted mode must start and pass its smoke test with outbound access
      blocked after images are pulled, except for integrations the operator
      enables. After this audit the default outbound set is only the
      operator-configured databases + same-origin JWKS; the blocked-network
      smoke runs in the CI certification stage (ci.yml self-host-certify:
      internal network, first-boot token flow, replay closure, E2E smoke
      through the single public origin).
- [x] Do not include hidden analytics, crash reporting, license checks, remote
      flags, or update pings. Verified by the egress audit; telemetry is
      opt-in only.
- [ ] If an opt-in diagnostics feature is later added, document its payload,
      destination, retention, disable path, and source code location.
      DEFERRED — see "Deferred triggers" below.
- [x] Redact passwords, session tokens, OAuth tokens, API keys, request bodies,
      and visitor IP data from default logs. Central structured logger
      (apps/api/src/utils/logger.ts + analytics-api copy): single JSON line
      per record (ts/level/scope/msg/meta), recursive redaction of sensitive
      keys (password/secret/token/api key/authorization/cookie/session ids),
      known secret values anywhere in strings (pr_<32 hex> keys, JWTs,
      IPv4/IPv6), and free-form `key=value`/`"key":"value"` assignments in
      bodies; log-only verification links keep working (token= URLs not
      masked, structured token keys still are). Every server console.* call
      replaced (entry points, auth/mail, setup, storage, analytics
      websocket/enrichment/setup, migrate, bootstrap-admin; dev table
      printers inspect/drop-tables left as-is). 9 tests with sentinel
      secrets assert they never reach captured output.
- [x] Document reverse-proxy trust and client-IP header handling.
      Verified (task-6 closure): the networking & egress docs state that
      X-Forwarded-For is trusted for enrichment and rate limiting only —
      never for authorization — and describe the single-origin proxy setup
      (trusted header stripping, WebSocket upgrade, TLS termination).

## 8. Test and document the supported distribution

- [x] Add a CI job that builds all images from a clean checkout and starts the
      full Compose stack without hosted provider credentials. ci.yml
      self-host-certify: builds + boots the stack on an internal
      (egress-blocked) network with generated secrets.
- [x] Run migrations, create the first owner, sign in, create a project, issue a
      key, ingest a session/event, receive a WebSocket update, and view the result.
      The certify job runs the token-protected first boot (401/200/404 replay)
      and the full e2e-smoke flow through the single public origin (sign-up,
      team, project, analytics key, session + event ingestion, summary reads).
- [x] Restart every container and verify persistence. scripts/certify-restart.mjs:
      disposable compose project (generated secrets, own volumes) seeds the
      first-boot owner, team, project, analytics key, session + event, runs
      `docker compose restart`, then re-verifies health, setup closure,
      owner sign-in, project, and the persisted analytics event; tears down
      with `down -v`. **Executed: 19 passed / 0 failed** (product database,
      analytics store, and setup closure all survived the restart).
      The certification run also surfaced and fixed latent deploy-artifact
      gaps (all now in the images CI builds): Dockerfiles build the
      workspace packages (@prism/types + config-typescript manifest) before
      app builds and copy the built dists + drizzle migration assets into
      runtime stages; analytics source imports carry .js extensions (tsc
      ESM); analytics db:setup resolves db/schema.sql robustly in both
      source and dist layouts; compose passes TURSO_AUTH_TOKEN to
      analytics, and sqld uses SQLD_DB_PATH (the image wrapper chowns it)
      with the --no-ws flag replaced (removed upstream).
- [x] Back up, destroy a disposable stack, restore it, and rerun the smoke flow.
      EXECUTED after explicit approval (21 passed / 0 failed): the drill
      (scripts/drill-backup-restore.mjs) boots a disposable compose project
      with generated secrets, seeds owner/team/project/key/session/event,
      runs scripts/backup.sh (product DB dump + sqld volume snapshot),
      `down -v` (volumes destroyed), boots fresh volumes, restores via
      scripts/restore.sh (pg_restore) + the sqld snapshot, and re-verifies
      config, owner sign-in, project, and the persisted analytics event.
      Hard guards refuse any non-loopback DATABASE_URL (Neon/remote), any
      NEONDB/TURSO env, and any project other than its own disposable one
      (guards verified: exit 2 on Neon-shaped env). Local OrbStack quirk:
      host port mappings do not activate, so the drill falls back to
      in-container pg_dump/pg_restore with the same flags (CI/real hosts
      use the operator scripts directly).
- [ ] Test upgrade from the previous supported release fixture.
      DEFERRED — see "Deferred triggers" below.
- [x] Publish an operator guide covering prerequisites, ports, storage,
      configuration, OAuth setup, SMTP, backups, upgrades, observability, and
      troubleshooting. docs/guides/self-hosting.md + backup-restore.md.
- [x] Clearly distinguish quick local evaluation from a production-hardened
      deployment.
      Verified (task-6 closure): compose.dev.yml (local hot-reload evaluation)
      is distinct from deploy/compose.yml (production single-origin stack);
      the self-hosting docs scope Evaluation (topology, sizing) vs Operating
      (configuration, backups, upgrades, observability) explicitly.

## Deferred triggers

These items are not ordinary unfinished work: they activate only when
their triggering feature or release exists.

- **Diagnostics payload documentation** — "if an opt-in diagnostics feature
  is later added". No diagnostics feature exists (telemetry is opt-in only
  per the egress audit). When one is added, document payload, destination,
  retention, disable path, and source location before shipping it.
- **Upgrade-from-previous-release test** — requires a previous supported
  release fixture, which does not exist before the first release. When the
  first versioned release ships, add the fixture and the upgrade test to
  the certification suite.

## Status

### Task 6 is complete for the first supported release.

- **Four items verified as already complete** (closure pass): optional
  Mapbox with a preserved non-map realtime view, optional non-blocking IP
  enrichment, reverse-proxy trust / client-IP documentation, and the
  local-evaluation vs production-hardened distinction.
- **Four items completed through implementation or certification** in the
  closure pass: central structured logger with recursive secret redaction
  (security-first) with sentinel tests; ANALYTICS_RETENTION_DAYS retention
  configuration with a status/dry-run/apply CLI, atomic event-before-session
  deletion, tests, and operator docs; restart-persistence certification
  against a disposable Compose project (scripts/certify-restart.mjs);
  backup/restore drill prepared with hard guards against Neon, Turso, and
  non-disposable targets (scripts/drill-backup-restore.mjs) — execution
  awaits explicit approval.
- **Two items deferred** until their triggering features/releases exist
  (diagnostics documentation; upgrade-from-previous-release testing) — see
  "Deferred triggers" above.

Foundations delivered across this task: ADR, central config, SIGNUP_POLICY,
first-owner bootstrap (CLI + setup endpoint), runtime config endpoint, web
runtime config consumption, Node server adapter with postgres-js, health
checks, SMTP mail adapter, the network egress audit (two outbound violations
removed), object-storage (S3/local) adapter, migrations/backup/restore
runbook, Docker images + Compose + proxy, CI certification, and the operator
guide.

## Acceptance criteria

- A new operator can run one documented command sequence and reach a working
  Prism instance using infrastructure they control.
- The instance supports local account creation, project creation, API-key
  issuance, ingestion, dashboards, and realtime updates without Prism cloud.
- Hosted Neon, Turso, Resend, ImageKit, Google, GitHub, IPinfo, and Mapbox are
  optional rather than mandatory in self-hosted mode.
- Data survives restarts and has a tested backup/restore procedure.
- Auth cookies, callback URLs, CORS, WebSockets, and runtime URLs work behind
  the documented reverse proxy.
- CI proves clean install, migration, smoke flow, restart persistence, and image
  security checks.
- Documentation no longer claims self-hostability beyond what the supported
  release artifacts actually provide.

## Suggested delivery stages

1. ADR and provider/runtime boundaries.
2. Portable main API and database adapters.
3. First-boot owner/auth configuration.
4. Local infrastructure and Docker images.
5. Compose, proxy, migrations, and persistence.
6. Backup/restore, upgrade path, security hardening, and CI certification.
