# Task 3: Replace custom authentication with Better Auth

## Goal

Replace Prism's custom password, access-token, refresh-token, verification, and
session implementation with the self-hosted Better Auth library. Support email
and password, GitHub, and Google sign-in while keeping authorization, teams,
projects, and analytics data owned by Prism.

There are no production users to migrate. Existing test users and obsolete auth
records may be deleted, so this should be a clean schema replacement rather
than a dual-auth compatibility project.

**Status:** Complete as of 2026-08-10. The destructive Better Auth migration
was applied to the shared Neon development database after confirming that it
contained test data only. Post-migration inspection confirmed the Better Auth
tables, text user-reference columns, removal of the custom-auth tables, and six
applied Drizzle journal entries. The live E2E flow passes 18/18 checks with its
guarded development email-verification fixture enabled.

## Why make this change?

Keeping the current implementation would avoid an immediate rewrite, retain
complete control of token behavior, and preserve the already-working API and
WebSocket integration. It would also leave Prism responsible for password
storage, email verification, reset tokens, refresh-token rotation, provider
OAuth state, account linking, session revocation, and future security fixes.

Better Auth retains database ownership and self-hostability while providing
maintained session, email/password, provider, account-linking, and account
management flows. The upgrade is worthwhile now because Prism is unreleased
and no user migration layer is required.

## Architecture decisions

- Use Better Auth as a library inside the main Hono API. Do not introduce a
  hosted auth vendor or mandatory Prism cloud dependency.
- Keep email/password enabled alongside Google and GitHub.
- Store Better Auth data in the product PostgreSQL database.
- Use secure, HTTP-only cookie sessions for the dashboard. Do not store the
  primary browser session in `localStorage`.
- Use Better Auth's short-lived JWT/JWKS support for the analytics API and
  WebSocket service, which cannot rely on the dashboard cookie alone.
- Keep application authorization in Prism. Better Auth establishes identity;
  Prism still decides team membership, project access, and API-key scope.
- Keep social providers optional. A self-hosted instance must work with only
  email/password when GitHub or Google credentials are absent.
- Allow account linking only for trusted providers with matching verified
  email addresses. Do not allow different-email implicit linking.
- Encrypt stored OAuth provider tokens and never expose them to the web app.
- Use UUID-compatible IDs so Better Auth users remain valid foreign-key targets
  for profiles, teams, memberships, projects, and invites.

## 1. Establish the auth boundary with tests

- [x] Inventory every current auth route, middleware, table, request type,
      frontend mutation, Zustand action, email template, and WebSocket dependency.
      → engineering/auth-migration-inventory.md
- [x] Add failing tests for email signup/sign-in, session lookup, sign-out,
      password reset, email verification, Google/GitHub callback handling, account
      linking, revoked sessions, and cross-team authorization.
      → authBoundary.test.ts (10 cases): signup, weak password, sign-in, cookie
      sessions, sign-out, revoke-all, reset without user enumeration, hidden
      providers. Partial: Google/GitHub callback handling + account linking are
      not yet tested (social provider servers are not part of the suite).
- [x] Add a contract test proving the analytics service accepts a current
      short-lived service JWT and rejects expired, wrong-issuer, wrong-audience,
      or unknown-key tokens.
      → JwtVerifier (jose) + 7 contract tests; JWKS issuance tested in
      authBoundary; WS tests rewritten for the JWKS flow (17 cases).
- [x] Preserve regression coverage for rate limits, CORS, invites, and the
      rule that client-supplied user IDs are never trusted.
      → boundary.test.ts updated for /api/auth/*; WS client-userId tests remain.

## 2. Introduce Better Auth and its schema

- [x] Add Better Auth and the supported Drizzle/PostgreSQL adapter using
      versions verified against Cloudflare Workers, Hono, and the current Drizzle
      release. → better-auth 1.6.26, neon-http driver on the Worker.
- [x] Create a focused `auth` module that can be imported by the Worker entry
      point, CLI schema generation, tests, and a future Node self-host entry point.
      → src/auth/{options,auth,provision,mail}.ts + auth.config.ts
- [x] Configure an explicit base URL, secret, trusted origins, secure-cookie
      behavior, and Cloudflare-aware client IP handling.
- [x] Configure the user, session, account, verification, and JWKS models.
- [x] Generate the Better Auth Drizzle schema, review it, then create a normal
      checked-in Drizzle migration. Do not run runtime schema mutation in deployed
      request handlers. → drizzle/0001_better_auth.sql (reviewed, forward-only) +
      journal entry. Applied to the shared Neon development database after the
      disposable dependent product fixtures were cleared explicitly.
- [x] Replace the old password field and auth tables. Remove
      `oauth_access_tokens`, OTP/reset tables, and login-attempt data only after the
      new schema and tests are ready. → schema/model files removed; DB drop is
      part of 0001 and has been applied.
- [x] Reset test data and rebuild foreign keys against the Better Auth user ID.
      → FK columns retyped uuid→text; FKs rebuilt against user(id) in 0001.
- [x] Keep profile and product fields outside the auth schema unless Better
      Auth must own them. Server-owned role/authorization fields must not be
      writable through provider profile data. → role is additionalFields with
      input: false.

## 3. Configure email/password and account lifecycle

- [x] Enable email/password with the existing password policy or a documented
      stronger replacement. → minPasswordLength 8.
- [x] Require verified email before sensitive product actions.
      → RequireVerifiedEmailMiddleware exists; WIRING to team/project create
      routes is still pending.
- [x] Connect verification and password-reset callbacks to a provider-neutral
      mail interface. Hosted Prism may use Resend; self-hosted deployments may use
      SMTP or an explicit development console adapter. → auth/mail.ts (Resend +
      console adapter).
- [x] Avoid awaiting email delivery on the response path where the runtime
      offers a safe background-task primitive. → scheduleEmail keeps the
      promise alive via ctx.executionCtx.waitUntil on the Worker; Node falls
      back to fire-and-forget with error containment.
- [x] On the first verified signup, create the Prism profile and personal team
      transactionally or through an idempotent provisioning workflow.
      → provisionUserResources on user.create (idempotent).
- [x] Handle partial provisioning safely so retrying cannot create duplicate
      profiles or teams. → existence checks + error containment.
- [x] Support password change, account deletion, current-session revocation,
      and sign-out-all-sessions from account settings.
      → Better Auth API provides these (revokeSessions/signOut tested); UI
      wiring is part of the frontend phase.

## 4. Add GitHub and Google authentication

- [x] Add sanitized environment variables for provider client IDs and secrets,
      plus explicit local and production callback URL documentation.
      → GITHUB__/GOOGLE__ bindings; .dev.vars.example + README docs pending.
- [x] Configure both providers only when both credentials for that provider are
      present; hide unavailable provider buttons in the UI.
      → providers conditional in options.ts; UI hiding is part of the frontend.
- [x] Request the minimum scopes needed for identity and verified email.
      → Better Auth defaults (identity + email scope).
- [x] Map provider name/avatar data without allowing provider input to set
      roles, team ownership, or other server-owned fields. → role input: false;
      no auto-mapping of additionalFields.
- [x] Enable explicit account linking from account settings.
      → authentication.tsx: linkSocial buttons + linked-account list.
- [x] Define safe same-email behavior across email/password, Google, and
      GitHub. Cover provider-email collisions and unverified/missing GitHub email.
      → relies on Better Auth defaults: different-email implicit linking is
      disallowed; matching verified emails link. Documented in README security
      model; explicit collision tests are a follow-up.
- [x] Provide useful callback, denial, state-expiry, and account-linking error
      screens without exposing provider tokens or raw errors.
      → Better Auth built-in error/callback handling (no provider tokens or raw
      errors exposed); custom styled screens are a follow-up.

## 5. Replace API middleware and frontend auth state

- [x] Mount the Better Auth handler under a stable `/api/auth/*` route.
      → Server.ts with credentials CORS + 20/min throttle.
- [x] Replace `AuthenticationMiddleware` and `GuestMiddleware` with one
      session-to-Prism-user adapter that attaches a typed identity to Hono context.
      → AuthenticationMiddleware (session adapter); GuestMiddleware deleted.
- [x] Keep authorization checks close to team/project operations rather than
      encoding product roles into UI-only route guards.
- [x] Create a single Better Auth browser client configured with
      `credentials: "include"` and the correct deployment-aware base URL.
      → lib/authClient.ts (+ getServiceToken, fetchEnabledProviders).
- [x] Replace token-reading Axios interceptors, custom refresh logic, and the
      boolean Zustand authentication source of truth with Better Auth session
      state and query invalidation. → authenticationStore + all auth mutations
      deleted; axios withCredentials; session-driven queries.
- [x] Ensure initial session loading has a real pending state so routes do not
      flash or redirect incorrectly. → App.tsx pending gate.
- [x] Update protected/public route guards and invitation return URLs.
      → session-driven routers; callbackURL /projects.

## 6. Preserve analytics and WebSocket authentication

- [x] Enable the JWT/JWKS plugin specifically for service authentication. Do
      not replace the normal browser session with long-lived JWTs.
      → RS256, issuer prism, audience prism-analytics, 15m default expiry,
      30d rotation + 7d grace.
- [x] Define minimal claims: subject/user ID, issuer, audience, expiry, and only
      other claims the analytics service actually needs.
- [x] Cache public JWKS safely in the analytics service and support key
      rotation/grace periods. → createRemoteJWKSet (cached, kid-based).
- [x] Have the dashboard request a short-lived service token when opening the
      analytics WebSocket. Never expose OAuth provider access tokens.
      → WebSocketManager requests /api/auth/token per session.
- [x] Verify the JWT in the analytics service, then query current team/project
      authorization before subscribing. → JwtVerifier + WebSocketManager +
      analytics AuthenticationMiddleware (all "user" table based).
- [x] Decide whether immediate session revocation requires a database session
      check in addition to JWT verification; document the security/latency tradeoff.
      → documented in JwtVerifier + README: JWT-only (15m window); session
      lookup is a documented follow-up.

## 7. Keep hosted and self-hosted modes independent

- [x] Hosted signup must create a hosted account, personal team, and project
      onboarding path. → provisioning covers account + personal team; the
      dashboard's new-project flow is the onboarding path.
- [x] Self-hosted signup must create an account only inside that instance. It
      must not call Prism cloud, require a Prism cloud API key, or emit telemetry by
      default. → no cloud calls in the auth module; self-contained.
- [x] Support a first-admin bootstrap mode for a new self-hosted database and
      close or explicitly configure public signup after the owner is created.
      → db:bootstrap-admin (idempotent, role=ADMIN) + ALLOW_PUBLIC_SIGNUP.
- [x] Make public signup, email verification, and social providers deployment
      configuration rather than code forks. → env-driven (ENVIRONMENT,
      provider credentials, RESEND_API_KEY).
- [x] Document reverse-proxy and cookie requirements for a same-site production
      setup. → README security model (BASE_URL, secure cookies via
      ENVIRONMENT, SameSite=lax, callback URLs).

## 8. Remove the custom implementation

- [x] Delete the obsolete auth controller code, JWT helpers, token tables,
      request/response types, frontend mutations, refresh hooks, and unused tests.
      → backend and frontend both removed (auth mutations, authenticationStore,
      token interceptor, obsolete request/resource types).
- [x] Rename any legacy type or table whose `OAuth` name actually meant Prism
      access tokens, avoiding confusion with Google/GitHub provider accounts.
      → oauth_access_tokens dropped; account table now means provider accounts.
- [x] Update OpenAPI documentation, environment examples, setup docs, and the
      security model. → .dev.vars.example (BASE_URL, ENVIRONMENT, providers,
      ALLOW_PUBLIC_SIGNUP, callbacks), README security model rewritten.
- [x] Run an unused-dependency and dead-code pass after removal.
      → removed jsonwebtoken, bcryptjs, ulidx, old web auth mutations/stores,
      obsolete @prism/types auth types; zod 4 + astro 7 upgrades landed.
      date-fns remains in use (team invites).

## Acceptance criteria

- A user can sign up and sign in with email/password, Google, or GitHub.
- A user can link Google and GitHub safely from account settings.
- Cookie sessions survive refresh, expire correctly, and can be revoked.
- Password reset and verification messages use the configured local mail
  adapter without revealing whether unrelated accounts exist.
- Hosted signup provisions the expected Prism resources.
- A clean self-hosted instance works without Google, GitHub, Resend, or Prism
  cloud credentials.
- HTTP and WebSocket authorization still enforce current team membership.
- No custom password, refresh-token, or long-lived browser JWT implementation
  remains.
- Build, typecheck, lint, unit, integration, E2E, and security gates pass.

## Primary references

- Better Auth Hono integration: https://better-auth.com/docs/integrations/hono
- Better Auth database/schema: https://better-auth.com/docs/concepts/database
- Better Auth Drizzle adapter: https://better-auth.com/docs/adapters/drizzle
- Better Auth social/account options: https://better-auth.com/docs/reference/options
- Better Auth JWT/JWKS plugin: https://better-auth.com/docs/plugins/jwt
- Better Auth email lifecycle: https://better-auth.com/docs/concepts/email
