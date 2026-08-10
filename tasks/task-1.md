# Task 1: Restore a safe local development baseline

## Goal

Get Prism running locally again, document its configuration, prove that the current code can build, and secure the analytics/realtime boundary before resuming feature development.

This task is intentionally broader than simply running `yarn install`. The local environment files are scaffolded but not yet populated, the repository has no meaningful project tests, and development was last left in the middle of production analytics/WebSocket troubleshooting.

## Definition of done

- Dependencies install reproducibly from the existing lockfile.
- Direct dependencies are audited and updated to supported versions in verified batches, with the refreshed Yarn lockfile committed.
- Each application has a local environment file, and all required values are populated without committing secrets.
- The existing Neon project is connected through a development-safe database or branch, and analytics use a non-production Turso database.
- Database setup is repeatable and does not rely on destructive commands.
- The web app, main API, and analytics API start locally and can communicate.
- Build, typecheck, lint, and test commands have been run and their remaining failures recorded or fixed.
- WebSocket subscriptions authenticate the caller instead of trusting a client-supplied user ID.
- Analytics session updates are scoped to the authenticated project.
- At least the critical auth, ingestion, and realtime paths have regression tests.
- The root README contains accurate local setup instructions once the process is proven.

## 1. Establish the toolchain

The repository declares Yarn Classic `1.22.19` and Node `>=18`. Start with Node 20 for compatibility with the project's 2024 dependencies, then only move to a newer Node version after the baseline is green.

Steps:

1. Confirm the selected Node version and enable Corepack.
2. Activate the declared Yarn version rather than silently regenerating the lockfile with a different package manager.
3. Install from the existing lockfile:

   ```sh
   corepack enable
   corepack prepare yarn@1.22.19 --activate
   yarn install --frozen-lockfile
   ```

4. Do not upgrade dependencies during this first pass. Record install warnings separately so compatibility problems are not mixed with dependency migrations.
5. Confirm that workspace packages resolve: `@prism/types`, `@prism/core`, and `@prism/react`.

Expected output: a reproducible install with no lockfile changes, or a short list of blockers explaining why that is not yet possible.

## 2. Audit and update dependencies

The dependencies were last updated in July 2024 and should be modernized as part of the initial recovery work. First preserve the current lockfile long enough to establish a baseline; then perform deliberate upgrades in small batches so regressions can be attributed to a specific change.

### Inventory and risk assessment

1. Record the installed and latest available versions of every direct dependency.
2. Run the package-manager security audit and distinguish exploitable production issues from development-only or unreachable transitive findings.
3. Identify unused, duplicated, deprecated, or replaced packages before upgrading them.
4. Read migration notes for major-version changes, especially:
   - TypeScript, Turbo, and the Yarn/Corepack toolchain
   - Hono, Wrangler, Drizzle, Neon, and Turso/libSQL clients
   - React, React Router, TanStack Query, Zustand, Vite, and Tailwind
   - Astro/Starlight, Biome, tsup, Vitest, and React Email
5. Decide the target Node version supported by the upgraded stack and update the root `engines` field if needed.

### Upgrade sequence

Upgrade related packages together while keeping independent changes separate:

1. Build tooling and shared configuration: TypeScript, Turbo, tsup, Vite, Biome, and type packages.
2. Shared Prism packages: `@prism/types`, `@prism/core`, and `@prism/react`.
3. Main API stack: Hono, Wrangler, Drizzle, Neon/Postgres clients, JWT, validation, and mail/upload dependencies.
4. Analytics API stack: Hono Node/WebSocket packages, Turso/libSQL, Postgres, JWT, and IP enrichment dependencies.
5. Web stack: React and React DOM first, followed by router, query/state, UI, charts, maps, and styling packages.
6. Documentation and email tooling last, since they are not required to prove the core product flow.

For each batch:

1. Update direct dependency ranges intentionally; do not use an unreviewed blanket `upgrade --latest` operation.
2. Regenerate `yarn.lock` using the declared Yarn version only.
3. Apply documented migration changes and remove compatibility workarounds that are no longer needed.
4. Run the affected workspace's build, typecheck, lint, and tests.
5. Run the core smoke flow when an API, SDK, database, or frontend runtime package changes.
6. Commit the batch separately with notes about breaking changes and verification performed.

Dependency modernization is complete when all direct dependencies are on intentional, supported versions; security findings have been fixed or documented; the lockfile is reproducible; and the full project verification suite passes.

## 3. Populate and validate the local environment files

The required local files have now been scaffolded with blank secret values and safe localhost defaults:

- `apps/api/.dev.vars`
- `apps/analytics-api/.env`
- `apps/web/.env.local`

All three files are ignored by Git. Fill in the existing Neon credentials and the other service keys locally; do not commit their values. After the setup has been verified, add sanitized `.example` equivalents so future installations have a committed variable inventory.

### Main API: `apps/api/.dev.vars`

The Cloudflare Worker reads bindings through `ctx.env`. The initial inventory is:

```dotenv
DATABASE_URL=<existing-neon-postgres-url>
JWT_SECRET_KEY=<long-random-local-secret>
CLIENT_URL=http://localhost:3001
RESEND_API_KEY=<optional-until-email-flows-are-tested>
IMAGE_KIT_API_KEY=<optional-until-upload-flows-are-tested>
PROJECT_NAME=prism_local
IP_INFO_API_TOKEN=<ipinfo-development-token>
TURSO_DATABASE_URL=<local-or-development-turso-url>
TURSO_AUTH_TOKEN=<development-turso-token>
```

The `DB` binding is configured by Wrangler rather than supplied as a normal environment variable. `Prism_KV_STORE` is declared in the types but appears unused and should be confirmed before creating a binding for it.

### Analytics API: `apps/analytics-api/.env`

```dotenv
PORT=8080
JWT_SECRET_KEY=<same-local-secret-used-by-the-main-api>
IP_INFO_API_TOKEN=<ipinfo-development-token>
TURSO_DATABASE_URL=<same-development-turso-url>
TURSO_AUTH_TOKEN=<development-turso-token>
NEONDB_PGHOST=<development-neon-host>
NEONDB_PGDATABASE=<development-neon-database>
NEONDB_PGUSER=<development-neon-user>
NEONDB_PGPASSWORD=<development-neon-password>
NEONDB_ENDPOINT_ID=<development-neon-project-or-endpoint-id>
```

The two APIs must point at compatible product and analytics stores: the analytics service looks up project API keys in the existing Neon database and writes sessions to Turso.

### Web app: `apps/web/.env.local`

```dotenv
VITE_API_URL=http://localhost:8787
VITE_WS_API_URL=ws://localhost:8080
```

Move the hardcoded Mapbox token to a named `VITE_MAPBOX_ACCESS_TOKEN` variable as part of the security/configuration pass. Do not place real credentials in committed example files.

### Environment validation

Add startup validation for required variables so each service fails with a useful message instead of failing later through a database or third-party request. Separate variables required for startup from those only required for email or upload flows.

## 4. Reconcile and initialize the databases

Use the existing Neon project rather than provisioning another one. Before running migrations, confirm that its connection targets a development-safe database or branch and not production data. Use a non-production Turso database for analytics.

### Product data

The main product schema is Postgres/Neon and includes users, profiles, teams, invites, projects, API keys, and OAuth access tokens.

1. Copy the existing Neon connection string into `DATABASE_URL`.
2. Copy the same connection details into the analytics API's `NEONDB_*` variables.
3. Review the existing Drizzle migration against the current schema definitions.
4. Run `yarn db:migrate` from `apps/api` only after confirming the target is a development-safe database or branch.
5. Verify that signup can create a user, profile, and personal team in one transaction.

Do **not** run `db:reinstall`: it invokes a script intended to drop every table in the target public schema.

### Analytics data

The checked-in `sessions` schema is exposed through a Wrangler D1 migration command, but both runtime APIs now read or write analytics through Turso/libSQL. Resolve this mismatch before considering database setup complete.

1. Decide whether Turso is the canonical analytics store.
2. If it is, add an explicit, idempotent Turso migration/setup command for the `sessions` table and indexes.
3. Remove or clearly label the older D1 path so developers do not initialize the wrong database.
4. Verify a session created through the analytics API can be read through the project summary endpoint.

## 5. Get the applications running locally

Start with the root Turbo workflow:

```sh
yarn dev
```

Expected local services:

- Web dashboard: `http://localhost:3001`
- Cloudflare Worker API: normally `http://localhost:8787`
- Node analytics API and WebSocket server: `http://localhost:8080`

If the combined command obscures a failure, run the relevant workspaces separately:

```sh
yarn workspace prism-api dev
yarn workspace prism-analytics-api dev
yarn workspace prism-web dev
```

Also ensure the shared packages build or run in watch mode before the web app consumes them. Confirm that the development build of `@prism/core` targets `http://localhost:8080`, not the old Render production URL.

Perform a minimal smoke flow:

1. Open the web app.
2. Create an account and sign in.
3. Create or select a team.
4. Create a project and copy its analytics key.
5. Start a browser session through `PrismClient`.
6. Confirm the session appears in the project overview.
7. Open the realtime page and confirm a new session produces a map marker.

## 6. Establish the build and quality baseline

Run the existing checks without changing their expectations first:

```sh
yarn build
yarn typecheck
yarn lint
yarn test
```

Known issues to investigate:

- `apps/api` has no `build`, `lint`, or `typecheck` scripts.
- `apps/analytics-api` has no lint, typecheck-only, or test script.
- The API TypeScript alias points at `packages/@prism/types`, while the actual workspace is `packages/types`.
- `packages/email-templates` has empty `build` and `dev` scripts.
- The current test suite contains no meaningful Prism application tests.
- Some root Turbo checks therefore do not cover every workspace.

Add consistent scripts for each active workspace. Prefer one-shot test commands in CI and watch commands only for local development. Record the initial failures, fix configuration errors first, and avoid bundling dependency upgrades into the same change.

## 7. Secure the last in-progress analytics work

Write failing regression tests first, then make the smallest implementation changes needed to pass them.

### WebSocket authentication

The current socket message includes a raw `userId`, and the server trusts it when checking project membership. Replace this with authenticated identity:

1. Require a signed access token during the WebSocket upgrade or the first message.
2. Verify the token and backing OAuth access-token record on the server.
3. Derive `userId` from the verified token; never accept it as proof of identity from client JSON.
4. Confirm that the authenticated user owns or belongs to the project's team.
5. Reject invalid, expired, revoked, cross-project, and malformed attempts.
6. Remove closed sockets from the in-memory client map.

### Analytics key handling

The web dashboard currently contains a hardcoded project write key. Remove it and rotate the key if it was ever deployed. Decide and document whether analytics write keys are intentionally public identifiers, as with many browser analytics SDKs. Even if public, restrict their capabilities to ingestion and add abuse controls such as rate limiting and optional allowed-origin/domain rules.

### Session ownership

Update session-ending logic so it modifies a session only when both `session_id` and the authenticated `project_id` match. Add tests proving a key from one project cannot end another project's session.

Minimum regression coverage:

- Invalid analytics key is rejected.
- Unauthenticated WebSocket connection cannot subscribe.
- A spoofed user ID cannot grant access.
- A valid user cannot subscribe to a project outside their teams.
- A valid project member can subscribe.
- A project key cannot end a different project's session.

## 8. Resume the incomplete product work

Only begin these after the local baseline and security boundary are stable:

1. Implement `PrismClient.logEvent` and `logCustomEvent`, including request schemas and ingestion endpoints.
2. Restore reliable session ending on page close/navigation, using an appropriate browser-safe delivery mechanism.
3. Build the project Events dashboard from stored event data.
4. Replace the realtime marker's placeholder profile form with actual session details.
5. Wire the password and authentication settings forms to their existing API endpoints.
6. Implement real project renaming; the current button incorrectly opens the delete-project component.
7. Replace the starter README and Starlight pages with product, SDK, API, and local-development documentation.

## Suggested delivery sequence

Keep the work reviewable by splitting it into small changes:

1. Reproduce the existing lockfile and capture the initial build baseline.
2. Audit dependencies and agree on target versions.
3. Upgrade tooling and dependencies in verified batches.
4. Populate and validate the local environment files.
5. Reconcile database setup.
6. Complete build/lint/typecheck configuration fixes.
7. Add the smoke-test harness and core integration tests.
8. Fix WebSocket and session-ownership security issues.
9. Complete SDK lifecycle and event tracking.
10. Finish the dashboard and documentation.

Each change should include the commands used to verify it and should avoid committing credentials, generated build output, or production data.
