# Task 3: Replace custom authentication with Better Auth

## Goal

Replace Prism's custom password, access-token, refresh-token, verification, and
session implementation with the self-hosted Better Auth library. Support email
and password, GitHub, and Google sign-in while keeping authorization, teams,
projects, and analytics data owned by Prism.

There are no production users to migrate. Existing test users and obsolete auth
records may be deleted, so this should be a clean schema replacement rather
than a dual-auth compatibility project.

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

- [ ] Inventory every current auth route, middleware, table, request type,
      frontend mutation, Zustand action, email template, and WebSocket dependency.
- [ ] Add failing tests for email signup/sign-in, session lookup, sign-out,
      password reset, email verification, Google/GitHub callback handling, account
      linking, revoked sessions, and cross-team authorization.
- [ ] Add a contract test proving the analytics service accepts a current
      short-lived service JWT and rejects expired, wrong-issuer, wrong-audience,
      or unknown-key tokens.
- [ ] Preserve regression coverage for rate limits, CORS, invites, and the
      rule that client-supplied user IDs are never trusted.

## 2. Introduce Better Auth and its schema

- [ ] Add Better Auth and the supported Drizzle/PostgreSQL adapter using
      versions verified against Cloudflare Workers, Hono, and the current Drizzle
      release.
- [ ] Create a focused `auth` module that can be imported by the Worker entry
      point, CLI schema generation, tests, and a future Node self-host entry point.
- [ ] Configure an explicit base URL, secret, trusted origins, secure-cookie
      behavior, and Cloudflare-aware client IP handling.
- [ ] Configure the user, session, account, verification, and JWKS models.
- [ ] Generate the Better Auth Drizzle schema, review it, then create a normal
      checked-in Drizzle migration. Do not run runtime schema mutation in deployed
      request handlers.
- [ ] Replace the old password field and auth tables. Remove
      `oauth_access_tokens`, OTP/reset tables, and login-attempt data only after the
      new schema and tests are ready.
- [ ] Reset test data and rebuild foreign keys against the Better Auth user ID.
- [ ] Keep profile and product fields outside the auth schema unless Better
      Auth must own them. Server-owned role/authorization fields must not be
      writable through provider profile data.

## 3. Configure email/password and account lifecycle

- [ ] Enable email/password with the existing password policy or a documented
      stronger replacement.
- [ ] Require verified email before sensitive product actions.
- [ ] Connect verification and password-reset callbacks to a provider-neutral
      mail interface. Hosted Prism may use Resend; self-hosted deployments may use
      SMTP or an explicit development console adapter.
- [ ] Avoid awaiting email delivery on the response path where the runtime
      offers a safe background-task primitive.
- [ ] On the first verified signup, create the Prism profile and personal team
      transactionally or through an idempotent provisioning workflow.
- [ ] Handle partial provisioning safely so retrying cannot create duplicate
      profiles or teams.
- [ ] Support password change, account deletion, current-session revocation,
      and sign-out-all-sessions from account settings.

## 4. Add GitHub and Google authentication

- [ ] Add sanitized environment variables for provider client IDs and secrets,
      plus explicit local and production callback URL documentation.
- [ ] Configure both providers only when both credentials for that provider are
      present; hide unavailable provider buttons in the UI.
- [ ] Request the minimum scopes needed for identity and verified email.
- [ ] Map provider name/avatar data without allowing provider input to set
      roles, team ownership, or other server-owned fields.
- [ ] Enable explicit account linking from account settings.
- [ ] Define safe same-email behavior across email/password, Google, and
      GitHub. Cover provider-email collisions and unverified/missing GitHub email.
- [ ] Provide useful callback, denial, state-expiry, and account-linking error
      screens without exposing provider tokens or raw errors.

## 5. Replace API middleware and frontend auth state

- [ ] Mount the Better Auth handler under a stable `/api/auth/*` route.
- [ ] Replace `AuthenticationMiddleware` and `GuestMiddleware` with one
      session-to-Prism-user adapter that attaches a typed identity to Hono context.
- [ ] Keep authorization checks close to team/project operations rather than
      encoding product roles into UI-only route guards.
- [ ] Create a single Better Auth browser client configured with
      `credentials: "include"` and the correct deployment-aware base URL.
- [ ] Replace token-reading Axios interceptors, custom refresh logic, and the
      boolean Zustand authentication source of truth with Better Auth session
      state and query invalidation.
- [ ] Ensure initial session loading has a real pending state so routes do not
      flash or redirect incorrectly.
- [ ] Update protected/public route guards and invitation return URLs.

## 6. Preserve analytics and WebSocket authentication

- [ ] Enable the JWT/JWKS plugin specifically for service authentication. Do
      not replace the normal browser session with long-lived JWTs.
- [ ] Define minimal claims: subject/user ID, issuer, audience, expiry, and only
      other claims the analytics service actually needs.
- [ ] Cache public JWKS safely in the analytics service and support key
      rotation/grace periods.
- [ ] Have the dashboard request a short-lived service token when opening the
      analytics WebSocket. Never expose OAuth provider access tokens.
- [ ] Verify the JWT in the analytics service, then query current team/project
      authorization before subscribing.
- [ ] Decide whether immediate session revocation requires a database session
      check in addition to JWT verification; document the security/latency tradeoff.

## 7. Keep hosted and self-hosted modes independent

- [ ] Hosted signup must create a hosted account, personal team, and project
      onboarding path.
- [ ] Self-hosted signup must create an account only inside that instance. It
      must not call Prism cloud, require a Prism cloud API key, or emit telemetry by
      default.
- [ ] Support a first-admin bootstrap mode for a new self-hosted database and
      close or explicitly configure public signup after the owner is created.
- [ ] Make public signup, email verification, and social providers deployment
      configuration rather than code forks.
- [ ] Document reverse-proxy and cookie requirements for a same-site production
      setup.

## 8. Remove the custom implementation

- [ ] Delete the obsolete auth controller code, JWT helpers, token tables,
      request/response types, frontend mutations, refresh hooks, and unused tests.
- [ ] Rename any legacy type or table whose `OAuth` name actually meant Prism
      access tokens, avoiding confusion with Google/GitHub provider accounts.
- [ ] Update OpenAPI documentation, environment examples, setup docs, and the
      security model.
- [ ] Run an unused-dependency and dead-code pass after removal.

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
