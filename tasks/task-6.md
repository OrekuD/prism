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

- [ ] Extract the main Hono application from its Cloudflare Worker entry point
      and provide both Cloudflare and Node server adapters.
- [ ] Put Worker bindings behind typed configuration/data interfaces so the
      product API does not import provider-specific globals in business logic.
- [ ] Add a standard PostgreSQL product-data adapter for Node deployments while
      retaining the Neon serverless adapter for hosted deployments.
- [ ] Keep the analytics Hono app runnable as a normal Node container with
      WebSocket upgrade support.
- [ ] Replace compile-time-only service discovery with a safe runtime config
      document or same-origin reverse-proxy paths for the built web image.
- [ ] Serve all browser/API/WebSocket traffic through one documented public
      origin in the default Compose topology. This simplifies Better Auth cookies,
      CORS, TLS, and callback URLs.
- [ ] Add `/health/live` and `/health/ready` checks that verify process health
      and required dependencies without leaking configuration.

## 3. Provide local infrastructure adapters

- [ ] Product database: support standard PostgreSQL with persistent storage.
- [ ] Analytics database: package the selected local libSQL/PostgreSQL option
      with persistent storage and the same migration contract as hosted mode.
- [ ] Email: support SMTP and a no-delivery development adapter in addition to
      optional Resend.
- [ ] Object storage: support an S3-compatible provider such as MinIO and/or a
      documented local-filesystem adapter in addition to optional ImageKit.
- [ ] Maps: keep Mapbox optional and preserve the non-map realtime/session view.
- [ ] IP enrichment: keep it optional and non-blocking.
- [ ] Rate limiting: define a shared/distributed implementation for multi-
      replica deployments, with a clearly documented single-process fallback.
- [ ] Secrets: support Compose secrets/files or an equivalent mechanism rather
      than requiring every secret on the command line.

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

## 5. Add migrations, backup, restore, and upgrades

- [ ] Build forward-only idempotent migration commands for every persistent
      store and run them as an explicit deployment job, not on arbitrary requests.
- [ ] Add versioned container images and a compatibility policy for database
      migrations, SDK/API versions, and rollback windows.
- [ ] Document backup and restore for PostgreSQL, analytics storage, object
      storage, and deployment secrets.
- [ ] Add an upgrade runbook with preflight checks, backup requirement,
      migration, health verification, and rollback guidance.
- [ ] Never make `db:reinstall` or drop-table commands available in production
      images.
- [ ] Add data retention/deletion configuration appropriate for an analytics
      product.

## 6. Package the deployment

- [ ] Add minimal multi-stage Dockerfiles for the web app, main API, analytics
      API, and docs only if docs are part of the supported runtime.
- [ ] Run containers as non-root with read-only filesystems where practical,
      explicit writable volumes, health checks, and resource limits.
- [ ] Add a production-oriented Compose file with pinned image versions,
      persistent named volumes, an internal network, and one reverse proxy.
- [ ] Add a separate development override rather than weakening production
      defaults.
- [ ] Provide a complete `.env.example` with generated-secret instructions and
      clear required/optional groupings.
- [ ] Ensure OAuth callback URLs and Better Auth trusted origins derive from the
      public instance URL.
- [ ] Add optional TLS automation guidance without binding the architecture to
      one DNS or certificate provider.

## 7. Protect privacy and independence

- [ ] Search for every outbound hostname and classify it as essential,
      optional, development-only, or accidental.
- [ ] Self-hosted mode must start and pass its smoke test with outbound access
      blocked after images are pulled, except for integrations the operator enables.
- [ ] Do not include hidden analytics, crash reporting, license checks, remote
      flags, or update pings.
- [ ] If an opt-in diagnostics feature is later added, document its payload,
      destination, retention, disable path, and source code location.
- [ ] Redact passwords, session tokens, OAuth tokens, API keys, request bodies,
      and visitor IP data from default logs.
- [ ] Document reverse-proxy trust and client-IP header handling.

## 8. Test and document the supported distribution

- [ ] Add a CI job that builds all images from a clean checkout and starts the
      full Compose stack without hosted provider credentials.
- [ ] Run migrations, create the first owner, sign in, create a project, issue a
      key, ingest a session/event, receive a WebSocket update, and view the result.
- [ ] Restart every container and verify persistence.
- [ ] Back up, destroy a disposable stack, restore it, and rerun the smoke flow.
- [ ] Test upgrade from the previous supported release fixture.
- [ ] Publish an operator guide covering prerequisites, ports, storage,
      configuration, OAuth setup, SMTP, backups, upgrades, observability, and
      troubleshooting.
- [ ] Clearly distinguish quick local evaluation from a production-hardened
      deployment.

## Status

Foundation committed (stage 1-3 partial): ADR, central deployment
configuration with fail-fast validation (variable names, no secrets),
SIGNUP_POLICY with secure defaults, hardened empty-database-only first-
owner bootstrap, public runtime config endpoint, and web-side runtime
config consumption (instance name in the auth shell, policy-aware
create-account). Remaining: runtime-portable adapters (Node entry,
PostgreSQL product adapter, SMTP/S3/maps/rate-limit adapters), Docker
images + Compose, migrations/backups, privacy hardening, and CI
certification.

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
