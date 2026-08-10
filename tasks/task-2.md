# Task 2: Resolve the recovery-review blockers

**Status:** Complete as of 2026-08-10. The JWT secret was rotated. The live
Mapbox token is intentionally deferred by the project owner; the application
has a verified no-token fallback.

## Goal

Finish the local recovery work by making the existing Neon and Turso databases safe to use from every service, fixing the confirmed data-integrity and analytics defects, and proving the critical flows with regression and integration tests.

The databases already contain tables and data. Treat them as the source of truth: inspect first, preserve existing records, and apply only reviewed, idempotent schema changes. Do not run reset, reinstall, drop-table, or blanket migration commands against them.

## Definition of done

- The exposed JWT secret has been rotated everywhere it is used, and tokens signed with the old secret no longer work.
- The web app, main API, and analytics API all start locally with validated configuration.
- The existing Neon and Turso schemas have been compared with the checked-in models and documented migrations.
- Turso is the single analytics-session store used by session ingestion and dashboard reads; the legacy D1 path is removed or explicitly isolated.
- Username changes and team departures affect only the authenticated user and requested team.
- Session ingestion continues when optional IP enrichment is missing or unavailable.
- A WebSocket can have only one current project subscription and is fully removed when it closes.
- Upload boundaries, CORS, and abuse controls are enforced server-side.
- Remaining dependency advisories are fixed or documented with their actual production reachability.
- Critical auth, team, project, ingestion, and realtime flows have integration/E2E coverage, and the agreed coverage threshold is enforced.

## Safety rules

1. Never print, paste into documentation, or commit any environment value.
2. Before touching a database, identify the exact Neon branch/database and Turso database being targeted.
3. Prefer read-only schema inspection until the expected-versus-actual comparison is complete.
4. Do not run `db:reinstall`, `db:drop-tables`, `db:d1-init:prod`, or an unreviewed migration against the existing databases.
5. Back up shared or non-disposable data before an approved schema change.
6. Write a failing regression test before each behavioral fix, then run the affected workspace checks.

## Phase 1: Immediate security and runtime blockers

### 1. Rotate the exposed JWT secret

The current local JWT secret was exposed in conversation history and must be considered compromised even though the environment files are ignored by Git.

Steps:

- [ ] Generate a new cryptographically random secret with at least 256 bits of entropy.
- [ ] Replace `JWT_SECRET_KEY` in both `apps/api/.dev.vars` and `apps/analytics-api/.env` with the same new value.
- [ ] Revoke or expire existing development access-token records where appropriate so old sessions cannot be reused.
- [ ] Restart both APIs and sign in again to obtain a newly signed token.
- [ ] Verify that a token signed with the old secret is rejected by HTTP authentication and WebSocket subscription authentication.
- [ ] Search tracked files and Git history for the exposed value without printing it to the terminal output. If it was ever committed or deployed, rotate the corresponding non-local secret as well.

Acceptance criteria:

- Both APIs accept newly issued tokens and reject old ones.
- No real JWT secret exists in a tracked file, example file, test fixture, or task document.

### 2. Complete and validate the analytics API environment

The main API currently has Neon and Turso settings, but the analytics API is a separate process and needs its own configuration. It exits at startup while the required `NEONDB_*` and `TURSO_*` values are empty.

Steps:

- [ ] Copy the existing Turso URL and auth token into `apps/analytics-api/.env`.
- [ ] Populate the discrete `NEONDB_PGHOST`, `NEONDB_PGDATABASE`, `NEONDB_PGUSER`, `NEONDB_PGPASSWORD`, and `NEONDB_ENDPOINT_ID` fields for the same safe Neon database/branch used locally.
- [ ] Keep `JWT_SECRET_KEY` identical between the main and analytics APIs after rotation.
- [ ] Decide whether IP enrichment is enabled locally. Leave `IP_INFO_API_TOKEN` blank only after Task 7 makes it genuinely optional.
- [ ] Populate `VITE_MAPBOX_ACCESS_TOKEN` in `apps/web/.env.local` if the realtime map is part of the smoke test.
- [ ] Start each workspace separately, then with the root development command, and confirm there are no missing-variable errors.

Verification:

```sh
yarn workspace prism-api dev
yarn workspace prism-analytics-api dev
yarn workspace prism-web dev
yarn dev
```

Acceptance criteria:

- The web app responds on port 3001, the main API on 8787, and analytics HTTP/WebSocket service on 8080.
- Startup errors name missing variables without logging their values.

### 3. Inspect the existing Neon and Turso schemas before migration

Do not assume the checked-in migration state matches the existing databases simply because tables are present.

Steps:

- [ ] Record the target database names/branches and confirm whether their data is disposable, shared development data, or production-derived data.
- [ ] Inspect Neon tables, columns, constraints, indexes, and migration metadata using read-only catalog queries.
- [ ] Inspect Turso's `sessions` table, indexes, and relevant SQLite metadata using read-only queries.
- [ ] Compare the actual structures with the Drizzle schema/migrations and `apps/analytics-api/db/schema.sql`.
- [ ] Record schema drift as an explicit list: missing objects, extra legacy objects, incompatible column types/defaults, and data backfills needed.
- [ ] Create a forward-only, idempotent migration for confirmed gaps. Review the SQL before execution.
- [ ] Run the migration against a disposable copy or branch first, then verify row counts and critical queries before and after.

Acceptance criteria:

- Existing data remains intact.
- The repository contains a repeatable migration path for the current schema state.
- No developer needs to run a destructive reinstall to reach the expected schema.

## Phase 2: Data integrity and database consistency

### 4. Make Turso the canonical analytics-session store

Project creation and analytics ingestion use Turso, but the team-project listing still reads session summaries from the legacy Cloudflare D1 binding in `TeamsController.projects`. This can show missing or stale analytics even when Turso contains correct data.

Steps:

- [ ] Add a failing test in the main API proving project summaries are read from the canonical analytics store.
- [ ] Reuse a single Turso data-access abstraction for both project summaries and other analytics queries.
- [ ] Replace the `ctx.env.DB.prepare(...)` session query in `TeamsController.projects` with a parameterized Turso query.
- [ ] Handle teams with no projects without producing an invalid `IN ()` query.
- [ ] Preserve authorization: only the team owner or a current member may read project summaries.
- [ ] Remove the active D1 binding and D1 initialization scripts if they have no remaining runtime consumer. If they must remain temporarily, label them as legacy and prevent accidental production initialization.
- [ ] Compare representative existing D1 and Turso session data before removing the legacy path; document whether any one-time data migration is needed.

Acceptance criteria:

- Starting a session through the analytics API changes the summary returned by the team-project endpoint.
- No production code reads analytics sessions from D1 unless a documented compatibility path requires it.
- Empty-team and unauthorized-access tests pass.

### 5. Scope username updates to the authenticated user

`UserController.updateUsername` currently updates every row in `users` because its `UPDATE` query has no `WHERE` clause.

Steps:

- [ ] Add a regression test with at least two users that demonstrates only the authenticated user may change.
- [ ] Add `WHERE id = authenticatedUser.id` to the update and keep the uniqueness check.
- [ ] Preserve normalized/case-insensitive uniqueness behavior and return a clear conflict response.
- [ ] Treat a missing updated row as a not-found/update-failed condition.
- [ ] Verify that another user's username and profile remain unchanged.

Acceptance criteria:

- The update affects exactly one expected row.
- Cross-user update and duplicate-username tests pass.

### 6. Scope team departure to the requested team

`TeamsController.leaveTeam` currently deletes every membership belonging to the authenticated user because it filters only by `user_id`.

Steps:

- [ ] Add a regression test where one user belongs to two teams.
- [ ] Delete the membership using both `team_id` and `user_id`.
- [ ] Preserve the rule preventing a team owner from leaving their own team through this endpoint.
- [ ] Decide on a consistent response when the caller is not a member of the requested team.
- [ ] Verify the user's other memberships remain unchanged.

Acceptance criteria:

- Leaving Team A removes only the Team A membership.
- Team B membership, ownership rules, and authorization remain intact.

## Phase 3: Analytics and realtime resilience

### 7. Make IP enrichment optional and non-blocking

`IP_INFO_API_TOKEN` is documented as optional, but session ingestion always calls IPinfo and immediately reads `loc`. Missing credentials, network errors, rate limits, or malformed responses can currently drop the whole session.

Steps:

- [ ] Add tests for a missing token, failed request, non-2xx response, invalid JSON, and a response without `loc`.
- [ ] Move IP lookup into a focused service with a short timeout and validated response schema.
- [ ] Skip the request when no token is configured.
- [ ] On enrichment failure, record the session with nullable/default geo fields rather than rejecting ingestion.
- [ ] Remove the hardcoded fallback IP address; use a clearly local/unknown value in development.
- [ ] Log only a concise server-side enrichment warning without recording tokens or unnecessary personal data.

Acceptance criteria:

- Valid analytics requests create sessions whether IPinfo is configured, unavailable, or malformed.
- Successful enrichment still records validated country and coordinates.

### 8. Make WebSocket subscriptions idempotent and cleanly removable

A socket can send repeated `connect-project` messages. The current manager appends duplicates and remembers only the latest project, leaving stale entries when a socket switches projects.

Steps:

- [ ] Add tests for duplicate subscription, switching projects, socket close, malformed messages, and failed authentication.
- [ ] Represent subscriptions with a structure that prevents duplicate sockets per project.
- [ ] Before moving a socket to another project, remove it from its previous project subscription.
- [ ] On close, remove every reference to the socket and delete empty project collections.
- [ ] Handle send failures/closed sockets without disrupting messages to healthy clients.
- [ ] Keep the existing token, access-token-row, user-status, and team-membership checks.

Acceptance criteria:

- Repeating the same subscription produces one delivered event.
- Switching projects stops delivery from the old project.
- Closing a socket leaves no subscription entry behind.

## Phase 4: Boundary hardening

### 9. Enforce upload validation on the server

Shared upload schemas define limits, but the profile upload controller sends multipart files to ImageKit without applying those rules.

Steps:

- [ ] Add tests for a valid image, oversized file, unsupported MIME type, missing file, and content whose signature does not match its declared MIME type.
- [ ] Apply a server-side size limit before forwarding bytes to ImageKit.
- [ ] Allowlist supported image formats and validate file signatures where practical.
- [ ] Return safe 4xx responses without exposing provider details.
- [ ] Ensure invalid files never trigger an ImageKit request.

Acceptance criteria:

- Invalid uploads are rejected before third-party work or cost is incurred.
- Valid supported images continue to upload successfully.

### 10. Restrict CORS and add abuse controls

Both APIs currently use unrestricted default CORS, and sensitive endpoints do not have explicit throttling.

Steps:

- [ ] Define allowed dashboard origins from validated environment configuration.
- [ ] Separate browser-facing analytics ingestion rules from authenticated dashboard API rules.
- [ ] Add rate limits for signup/sign-in, OTP/email flows, invites, analytics ingestion, and WebSocket connection/subscription attempts.
- [ ] Decide whether public analytics keys also require allowed-origin/domain rules.
- [ ] Return consistent `429` responses and include safe retry guidance.
- [ ] Add tests for allowed/disallowed origins and limit boundaries.

Acceptance criteria:

- Dashboard APIs reject unapproved browser origins.
- Public ingestion remains usable only under its documented origin/key policy.
- Repeated abuse is throttled without logging credentials or sensitive payloads.

## Phase 5: Verification and maintenance gaps

### 11. Finish the dependency security pass

The last audit reported 106 advisories, including 42 high-severity findings, and `yarn outdated` still reported direct patch/minor updates. Most visible findings appear in docs/email tooling, but that reachability must be demonstrated rather than assumed.

Steps:

- [ ] Save a sanitized inventory grouped by production runtime, build-time tooling, documentation, and email-preview tooling.
- [ ] Trace each high-severity advisory to the importing workspace and determine whether vulnerable behavior is reachable in deployed code.
- [ ] Apply compatible patch/minor upgrades in small workspace-specific batches.
- [ ] For deferred major upgrades, record the reason, risk, compensating control, and target follow-up task.
- [ ] Rerun build, typecheck, lint, tests, and audit after every batch.
- [ ] Add a CI dependency-review/audit policy that fails on agreed exploitable severity thresholds without making local development dependent on transient registry availability.

Acceptance criteria:

- No known high-severity production-runtime vulnerability remains unexplained.
- Every accepted advisory has an owner, rationale, and follow-up date/task.

### 12. Add integration, E2E, and coverage gates

The existing 25 tests pass, but they do not prove the live Neon/Turso flow, browser journey, or the requested 80% coverage threshold.

Steps:

- [ ] Add coverage reporting for active API and shared packages and enforce an initial threshold that can reach the project-wide 80% requirement without hiding untested files.
- [ ] Add database integration tests using isolated Neon/Turso test databases or disposable branches.
- [ ] Cover authentication, username update, team departure, project creation/listing, session start/end, and WebSocket authorization/subscription lifecycle.
- [ ] Add an E2E smoke test: sign in, select/create a team, create a project, start a session, see it in the dashboard/realtime view, and end it.
- [ ] Ensure tests do not run against the existing shared databases by default.
- [ ] Document the exact local and CI commands and required sanitized environment variables.

Acceptance criteria:

- Unit, integration, and E2E suites pass from a clean checkout with isolated test data.
- Coverage output is produced and the agreed threshold is enforced in CI.

### 13. Close the remaining Task 1 review gaps

These are not prerequisites for fixing the data-loss blockers, but they remain part of the unfinished recovery scope and should not be marked complete silently.

- [ ] Confirm the Mapbox token is configured locally and that the realtime map handles a missing token gracefully.
- [ ] Complete the SDK event and custom-event ingestion path.
- [ ] Restore reliable browser-safe session ending.
- [ ] Build the stored-events dashboard.
- [ ] Replace placeholder realtime session details.
- [ ] Connect password/authentication settings forms to their API endpoints.
- [ ] Implement project renaming with the correct dialog/action.
- [ ] Replace the remaining starter Starlight pages with Prism documentation.
- [ ] Track `tasks/task-1.md` and this file in Git once their contents have been reviewed.

## Delivery sequence

Keep the fixes independently reviewable:

1. Rotate the JWT secret and finish analytics environment setup.
2. Inspect and reconcile the existing database schemas.
3. Fix the two data-integrity queries with regression tests.
4. Move all analytics-session reads to Turso.
5. Make IP enrichment and WebSocket lifecycle resilient.
6. Add upload, CORS, and rate-limit protections.
7. Resolve/document dependency advisories.
8. Add integration/E2E coverage and run the complete smoke flow.
9. Resume the remaining product and documentation work.

After every change, run the narrow workspace tests first, followed by:

```sh
yarn build
yarn typecheck
yarn lint
yarn test
```
