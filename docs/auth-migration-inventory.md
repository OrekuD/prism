# Auth migration inventory (Task 3: Better Auth)

Recorded before the migration so nothing custom is left behind.

## Current custom auth surface

### Routes (main API, Hono)
- `POST /api/v1/auth/sign-in` — email/password, bcrypt, issues JWT wrapping an
  opaque token stored in `oauth_access_tokens`
- `POST /api/v1/auth/sign-up` — creates user + profile + personal team in one
  transaction, then signs in
- `POST /api/v1/auth/sign-out` — deletes the oauth_access_tokens row
- `POST /api/v1/auth/sign-out-from-all-sessions`
- `POST /api/v1/auth/forgot-password` / `reset-password` — JWT reset links
- `POST /api/v1/auth/verify-email` — JWT verification link
- `POST /api/v1/auth/magic-link` / OTP endpoints exist in code
  (`requestMagicLinkSignIn`, `otpSignIn`, `requestOTPSignIn`) but are NOT
  mounted in AuthRouter
- `GET /api/v1/user` + PUT endpoints (profile, username, password, email,
  verify-email) — all behind `AuthenticationMiddleware`

### Tables (Postgres, Drizzle schema)
- `users` — id, email, password (bcrypt), user_name, role, created_at,
  updated_at
- `oauth_access_tokens` — opaque access token + refresh token rows
- `otp_sign_ins`, `login_attempts` — unused by mounted routes
- Product tables referencing `users.id` (FK): `profiles`, `profile_pictures`,
  `teams` (owner_id), `team_members`, `team_invites`, `projects` (creator_id)

### Web (React)
- `authenticationStore` (Zustand, persisted): accessToken/refreshToken +
  boolean `isAuthenticated`
- `userStore` (Zustand, persisted): UserResource
- axios instance reads `localStorage["token"]` per request (interceptor)
- WebSocket client sends the access JWT in `connect-project`
- Routes: `auth/create-account`, `auth/log-in`, `auth/forgot-password`,
  `auth/reset-password`; mutations: sign-in, sign-up, sign-out,
  sign-out-from-all-sessions

### Analytics API
- `AuthenticationMiddleware` (unused) and `WebSocketManager.authenticate`
  verify a JWT with `jsonwebtoken` using the shared `JWT_SECRET_KEY`, then
  check `oauth_access_tokens` (not revoked, not expired) + team membership.

## Target (Better Auth)

- Library inside the main Hono API: `/api/auth/*` handler (cookies).
- Email/password + GitHub + Google (providers optional by config).
- Drizzle adapter on the product Postgres; `user`/`session`/`account`/
  `verification`/`jwks` tables (camelCase, Better Auth standard).
- UUID-compatible ids (`advanced.generateId` → `crypto.randomUUID`) so
  product FKs keep working.
- JWT plugin (RS256, JWKS at `/api/auth/jwks`, token at `/api/auth/token`)
  for the analytics/WebSocket service; browser sessions stay cookie-based.
- `databaseHooks.user.create.after` provisions profile + personal team
  idempotently.
- Mail: MailManager (Resend) with a development console adapter when
  `RESEND_API_KEY` is absent.
- Prism keeps all authorization: teams, projects, invites, API keys.
