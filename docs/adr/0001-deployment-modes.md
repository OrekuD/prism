# ADR 0001: Hosted and self-hosted deployment modes

Status: Accepted (2026-08-10)
Context: task-6.md — make self-hosting a first-class deployment mode

## Decision

1. **One codebase, one feature model.** `hosted` and `self-hosted` are
   explicit deployment modes selected by `PRISM_DEPLOYMENT_MODE`. There is
   no community edition and no feature gating by mode: the difference is
   configuration and infrastructure adapters.

2. **Supported operating target.** The first supported self-hosting profile
   is a single Linux host running Docker Compose: web, main API, analytics
   API, and a reverse proxy behind one public origin. Packaging for this
   profile follows in the later delivery stages of task-6.

3. **Analytics store.** Prism keeps the existing two-store architecture for
   now: product data in PostgreSQL (Neon in hosted mode) and analytics
   events/sessions in a libSQL service (Turso in hosted mode, self-hosted
   libSQL/sqld locally). Rationale: the analytics service already has a
   tested storage contract, WebSocket integration, and migrations; a
   PostgreSQL analytics migration is evaluated as a follow-up ADR when
   operational data justifies it, not before. Both stores keep the same
   migration contract in hosted and self-hosted modes.

4. **Adapters, not forks.** Provider-specific code (Neon, Turso, Resend,
   ImageKit, IPinfo, Mapbox, social providers) stays behind typed
   configuration and adapters. None of these providers is mandatory in
   self-hosted mode: standard PostgreSQL, self-hosted libSQL, SMTP/no-op
   mail, local filesystem/S3 storage, and the non-map realtime view are the
   fallbacks. Configuration is resolved centrally and fails fast with
   variable names and remediation, never secret values.

5. **Identity.** A self-hosted visitor signs into the local instance; there
   is no Prism cloud identity in self-hosted mode. Auth cookies, callback
   URLs, CORS, and JWKS derive from the instance's public URL (`BASE_URL`),
   which the operator owns.

6. **Registration policy.** Public registration is an explicit setting
   (`SIGNUP_POLICY=open|invite-only|disabled`). Hosted defaults to `open`;
   self-hosted defaults to `disabled` (secure default). The first owner is
   created by the empty-database-only bootstrap command, which refuses to
   run once any user exists.

7. **Telemetry.** Product telemetry and update checks are opt-in and
   documented. Self-hosted mode must start and pass its smoke test with
   outbound access blocked. No hidden analytics, crash reporting, license
   checks, remote flags, or update pings are added.

8. **License.** The repository's existing license governs the self-hosting
   release. No rights beyond what that license grants are implied by the
   deployment artifacts.

## Consequences

- Future work must not introduce hosted-only assumptions: adapters and
  configuration come first, providers second.
- The web app reads runtime configuration (`GET /api/v1/config`, public,
  no secrets) instead of relying on compile-time URLs for instance-level
  behavior.
- Operator-owned concerns (database, keys, backups, retention, upgrade
  timing) are documented and exercised by the task-6 delivery stages.
