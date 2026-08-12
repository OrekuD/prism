<p align="center">
  <img src="packages/brand/assets/prism-logo.png" width="96" height="96" alt="Prism" />
</p>

# Prism

Real-time website analytics for teams: a Cloudflare Worker API, a Node analytics
API with WebSockets, a React dashboard, and a browser SDK.

## Stack

| Workspace | What it is | Local URL |
| --- | --- | --- |
| `apps/web` (`prism-web`) | React/Vite dashboard | http://localhost:5173 |
| `apps/api` (`prism-api`) | Cloudflare Worker product API (auth, teams, projects) | http://localhost:8787 |
| `apps/analytics-api` (`prism-analytics-api`) | Node/Hono analytics API + WebSocket server | http://localhost:8080 |
| `apps/docs` (`prism-docs`) | Astro Starlight docs | http://localhost:4321 |
| `packages/core` (`@prism/core`) | Browser analytics SDK (`PrismClient`) | — |
| `packages/prism-react` (`@prism/react`) | React bindings for the SDK | — |
| `packages/types` (`@prism/types`) | Shared request/response types & schemas | — |

## Prerequisites

- **Node 20** (LTS). The repo declares `engines.node >= 20`; development is
  verified on Node 20.19.x. Install via nvm: `nvm install 20 && nvm use 20`.
- **Yarn Classic 1.22.19** (the repo is pinned via `packageManager`).
  Activate it with Corepack:

  ```sh
  corepack enable
  corepack prepare yarn@1.22.19 --activate
  ```

## Install

```sh
yarn install --frozen-lockfile
```

The lockfile is committed; use `--frozen-lockfile` for reproducible installs.

## Local environment files

All real credentials live in git-ignored files. Copy the `.example` files and
fill them in — never commit secrets.

| File | Purpose |
| --- | --- |
| `apps/api/.dev.vars` | Worker bindings: Neon `DATABASE_URL`, `JWT_SECRET_KEY`, `CLIENT_URL`, optional `RESEND_API_KEY`/`IMAGE_KIT_API_KEY`, Turso + ipinfo tokens |
| `apps/analytics-api/.env` | `PORT`, same `JWT_SECRET_KEY` as the main API, Turso URL/token, Neon `NEONDB_*` connection details, ipinfo token |
| `apps/web/.env.local` | `VITE_API_URL=http://localhost:8787`, `VITE_WS_API_URL=ws://localhost:8080`, `VITE_MAPBOX_ACCESS_TOKEN` (your own Mapbox public token) |

Generate a JWT secret with `openssl rand -hex 32` and use the **same value** in
the main API and the analytics API.

Both APIs validate their required variables at startup and exit with a list of
what is missing, so a misconfigured environment fails fast instead of blowing
up on the first database call.

## Databases

### Product data (Neon/Postgres)

Copy an existing Neon connection string into `apps/api/.dev.vars` → `DATABASE_URL`
and mirror the host/database/user/password/endpoint into the `NEONDB_*` values of
`apps/analytics-api/.env`. **Use a development branch, never production.**

Apply the Drizzle migrations (only after confirming the target):

```sh
yarn workspace prism-api db:migrate
```

Do **not** run `db:reinstall` — it drops every table in the target schema.

### Analytics data (Turso — canonical store)

Sessions live in Turso/libSQL. Setup is idempotent and never drops tables:

```sh
yarn workspace prism-analytics-api db:setup
```

The older D1 path (`apps/api/d1`, `db:d1-init*`) is legacy and kept only for
history — do not initialize it for new setups.

## Run everything

```sh
yarn dev
```

Or run workspaces individually:

```sh
yarn workspace prism-api dev          # Worker API on :8787
yarn workspace prism-analytics-api dev  # analytics API + WS on :8080
yarn workspace prism-web dev          # dashboard on :5173
```

`@prism/core` and `@prism/react` build in watch mode as part of `yarn dev`; the
SDK's development build targets `http://localhost:8080`.

### Smoke flow

1. Open http://localhost:5173 and create an account.
2. Create/select a team, create a project, copy its analytics key
   (project → Settings → API keys).
3. In the browser console, start a session with the SDK:

   ```js
   import { PrismClient } from "@prism/core";
   const prism = new PrismClient({ key: "YOUR_API_KEY" });
   prism.startSession({ referrer: document.referrer, location: "" });
   await prism.logEvent("button-click", { label: "signup" });
   ```

4. The session appears in the project overview; the realtime page shows a map
   marker for it (requires `VITE_MAPBOX_ACCESS_TOKEN`).
5. Logged events appear on the project's Events dashboard.

## Quality gates

```sh
yarn build       # all workspaces
yarn typecheck   # tsc --noEmit per workspace
yarn lint        # Biome per workspace
yarn test        # Vitest (unit + security regression tests)
```

Coverage is enforced per workspace (`test:coverage`, thresholds in each
`vitest.config.ts`, policy in `engineering/coverage.md`).

### Integration tests (opt-in, isolated databases only)

The integration suites hit real databases and are **skipped by default** so
they never touch the shared development databases. Point them at an isolated
test database / disposable Neon branch and disposable Turso database:

```sh
# Product flows (Neon): signup transaction, username scoping, team departure,
# project-key uniqueness
PRISM_RUN_INTEGRATION=1 yarn workspace prism-api test

# Analytics flows (Turso): session start/read/end, cross-project scoping
PRISM_RUN_INTEGRATION=1 yarn workspace prism-analytics-api test
```

### E2E smoke test

With the services running locally (and real or disposable credentials):

```sh
node scripts/e2e-smoke.mjs
```

Covers: sign up → sign in → create team → create project → start a session
through the ingestion API → verify the session appears in the team-project
summary (Turso) → end the session → verify a bogus key cannot end sessions.

### CI

`.github/workflows/security.yml` runs the dependency audit weekly and on
lockfile changes; it fails only when a high/critical advisory is reachable
from a production workspace and is not documented (see
`engineering/dependency-security.md` and `scripts/audit-check.mjs`).

Security regression tests live in:

- `apps/analytics-api/src/__tests__/WebSocketManager.test.ts` — WebSocket
  authentication: unauthenticated/invalid/revoked/expired tokens are rejected,
  client-supplied user IDs are never trusted, project membership is enforced,
  closed sockets are removed.
- `apps/analytics-api/src/__tests__/AnalyticsController.test.ts` — session
  updates are scoped to the authenticated project.
- `apps/analytics-api/src/__tests__/AnalyticsMiddleware.test.ts` — analytics
  key validation.
- `apps/api/src/__tests__/AuthenticationMiddleware.test.ts` — API token
  verification path.

## Security model

- **Authentication is Better Auth** (self-hosted, in the main API):
  - Dashboard sessions are HTTP-only, SameSite cookies (`prism.session_token`)
    — never `localStorage`. Sessions can be revoked individually or globally.
  - Email/password (min 8 chars), plus GitHub/Google when credentials are
    configured; providers are hidden otherwise. Callback URLs:
    `{BASE_URL}/api/auth/callback/{github|google}`.
  - Password reset and email verification go through a provider-neutral mail
    adapter: Resend when `RESEND_API_KEY` is set, otherwise a development
    console adapter prints the link. Responses never reveal whether an email
    exists.
  - Sensitive actions (create team/project, send invites) require a verified
    email.
  - Registration policy is explicit: `SIGNUP_POLICY=open|invite-only|disabled`
    (hosted defaults to open; self-hosted defaults to disabled until the
    operator opens it). Self-hosted instances create the first owner with
    `yarn workspace prism-api db:bootstrap-admin` (empty-database-only
    unless `BOOTSTRAP_FORCE=1`).
- **Service authentication (analytics API + WebSocket)** uses the Better Auth
  JWT plugin: the dashboard requests a short-lived token (issuer `prism`,
  audience `prism-analytics`, RS256, ~15m expiry) from `/api/auth/token` and
  the analytics service verifies it against `/api/auth/jwks` (cached, kid-
  based rotation with a grace period). The browser session is never replaced
  by a long-lived JWT, and OAuth provider tokens stay encrypted in the
  `account` table — never exposed to the web app. Revocation tradeoff: JWT-
  only verification (no per-request session lookup), so a revoked session
  stays usable until token expiry.
- **Authorization stays in Prism**: Better Auth establishes identity; team
  membership, project access, and API-key scope are always checked in the
  controllers. Client-supplied user IDs are never trusted (WebSocket tests
  cover this).
- **Analytics write keys** are public identifiers by design (browser SDKs must
  embed them), but they are restricted to session/event ingestion; they cannot
  read data or manage projects. Session-ending requests are scoped to the
  project that owns the key. Rate limits (auth 20/min, ingestion 120/min,
  WS 30/min per IP) return 429 with Retry-After.
- The dashboard's Mapbox token is configured via `VITE_MAPBOX_ACCESS_TOKEN`,
  not hardcoded.

## Notes & known follow-ups

- Remaining majors (React 19, React Router 7, Tailwind 4, Biome 2, TypeScript
  6/7) are intentionally deferred — see commit messages for the upgrade
  batches and verification performed. Zod 4 and Astro 7 (docs) were upgraded
  during Task 3; `yarn audit` reports zero high/critical advisories.
- `packages/email-templates` preview server advisories are dev-only tooling
  (see engineering/dependency-security.md).
- `apps/api` has no dedicated build output — `wrangler deploy` bundles the
  worker; the `build` script runs the type check.
- `@prism/email-templates` `build`/`export` renders templates with
  `react-email`; the preview server (`email dev`) is dev-only tooling.
