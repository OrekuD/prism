# Task 14: Prove the hosted Prism platform with a live React telemetry integration

**Status:** Planned
**Created:** 2026-08-17
**Depends on:** Task 9 analytics v2 foundation, Task 10 identity baseline, and
Task 13 Better Auth organizations and source-aware keys
**Scope:** One real React application sending product analytics to Prism's
hosted platform, then viewing that data through the hosted authenticated web
application.

## Goal

Prove that Prism's **hosted main platform** works as a product, not only as
isolated packages and tests. An engineer must be able to create an account on
the hosted service, install the Core, Browser, and React packages into a
separate React application, initialize a source-specific client, send real
events over HTTPS, and inspect the resulting events, people, and live activity
in the hosted dashboard.

This is Prism's first **live hosted-platform integration test**. It uses the
hosted product stack in an externally reachable, production-like test
environment: the hosted web app, product API, analytics API, databases, and
WebSocket route. It is not an npm publish, a public beta, or a production
launch. Self-hosted deployment certification is explicitly out of scope.

## The test journey that defines success

```text
Create/sign in to hosted Prism
  -> choose a workspace
  -> create a project for one logical product + environment
  -> create a Web source and allow the test app's exact HTTPS origin
  -> reveal its publishable source key once
  -> install packed @prism-analytics/core, @prism-analytics/browser, and @prism-analytics/react in a
     separate React app
  -> load the React app and generate sessions, events, identity changes
  -> sign in to Prism and inspect the same data in Overview, Events, People,
     Live Activity, and Sources
```

The journey is successful only when it exercises real package artifacts, hosted
network routing, source-key authorization, database persistence, read APIs,
and the hosted web UI. A monorepo import, mocked transport, manually inserted
database event, or self-host-only smoke test does not count.

## Product decisions this task locks

### Workspace, project, source, and key model

Prism uses this hierarchy:

```text
Workspace (Better Auth Organization)
  -> Project (one logical product in one environment)
       -> Source (one installed producer: Web, React Native, iOS, Android,
          or Server)
            -> one or more rotation-period ingestion keys
```

- A project is the shared analytics boundary for one product/environment, for
  example `Acme - production`. Its web app, mobile app, and server can share
  people and cross-platform journeys.
- A source is an installation and setup boundary, for example `Acme web`,
  `Acme iOS`, or `Acme API`. It supplies trusted platform/source context to
  accepted telemetry.
- An ingestion key belongs to exactly one source. It never receives a
  client-supplied project or workspace ID.
- Browser/mobile sources use publishable, telemetry-write-only keys. A Web
  source also has an explicit allowed-origin policy.
- Server sources use secret telemetry-write-only keys, which must never enter
  browser bundles, setup screenshots, fixtures, or client documentation.
- Multiple active keys are permitted only for an intentional rotation window;
  normal setup creates one current key.

Task 13 implements this model. This task validates it with a real origin and
turns it into the public SDK and dashboard experience. There is no standalone
project-level **API keys** destination in the initial product navigation:
keys live inside their source.

### SDK configuration terminology

The current SDK option is named `projectKey`, but a key is now source-bound.
That name is misleading and must not become the public contract for the first
real integration.

- [x] Rename the public SDK configuration field from `projectKey` to
      `sourceKey` across `@prism-analytics/core`, `@prism-analytics/browser`, `@prism-analytics/react`
      documentation, setup snippets, error messages, tests, and types.
- [x] Because Prism has not launched, remove the misleading public option
      rather than carrying a permanent compatibility alias. Record any
      deliberately retained internal names in the implementation notes.
- [x] Keep `endpoint` explicit and runtime-configured. For this test it is
      Prism's hosted ingestion origin; retaining runtime configuration also
      preserves future self-hosting without compiling an endpoint into a
      package.
- [x] Do not add a client option for `projectId`, `organizationId`, source ID,
      key type, or platform. The analytics service derives those from the
      authenticated source key.

The intended React usage is deliberately a ready-client provider, not an
async configuration provider that can create multiple queues during React
renders:

```tsx
const client = await createBrowserClient({
  sourceKey: import.meta.env.VITE_PRISM_SOURCE_KEY,
  endpoint: import.meta.env.VITE_PRISM_INGEST_URL,
  collection: { initialState: "granted" },
});

root.render(
  <PrismProvider client={client}>
    <App />
  </PrismProvider>,
);
```

The exact bootstrap helper or example may improve during implementation, but
it must preserve these invariants: one explicitly owned client, no client
creation in render, no duplicate queue/session under React Strict Mode, and an
explicit shutdown path for an app that owns the client lifecycle.

## Scope and non-goals

In scope:

- `@prism-analytics/core`, `@prism-analytics/browser`, and `@prism-analytics/react` as usable, packed
  prerelease artifacts.
- A real React/Vite fixture application outside the workspace dependency
  resolution path.
- Browser event/session/identity collection with the existing explicit consent
  model.
- Source setup, source-key rotation/revocation, allowed-origin enforcement,
  dashboard reads, and authenticated workspace/project navigation.
- A hosted, production-like Prism test environment sufficient to prove the
  public-origin ingest path, hosted auth, dashboard reads, and WebSockets.

Out of scope:

- npm publication, billing, a marketing launch, or opening the hosted service
  to external customers.
- React Native, iOS, Android, and Node SDK releases. Their source records may
  exist in the product model, but they are not part of this first live proof.
- Automatic event/page capture, session replay, feature flags, experiments,
  surveys, performance monitoring, generic logs, or error tracking. Error
  tracking begins in Task 15 and must not be represented by a fake SDK method.
- A self-hosted deployment/image/public-origin certification. Task 13's
  self-hosted deployment checks remain deferred for their own release pass.
- A production migration. Task 13's authorized destructive reset remains a
  pre-launch-only decision.

## Initial dashboard information architecture

The design system may reserve room for future modules, but the initial live
sidebar renders only routes that work. Do not ship disabled or `Coming soon`
links merely to make the navigation look larger.

```text
[Workspace switcher]

WORKSPACE
  Workspace overview
  Projects
  Members

PROJECT: <selected project>
  Overview

DATA
  Events
  People
  Live
    Activity | Map                 (local views of the Live page)

CONFIGURE
  Sources
    Overview | Setup | Keys | Settings  (local views of one source)
  Settings

Footer: Documentation · Theme · Account
```

Rules:

- The workspace switcher is backed by Better Auth's active organization. It
  must not be a second workspace authority.
- The project context is selected from projects the active member may access.
  Every project read still validates membership server-side; switching the UI
  context grants no access.
- `Members` is a workspace-level page backed by Better Auth organizations and
  invitations. It is not a Prism-owned team system.
- `Sources` owns installation instructions, origin policy, keys, key rotation,
  and source health. It replaces a project-level `API keys` sidebar link.
- `Activity | Map` and `Overview | Setup | Keys | Settings` are local views of
  one bounded route/resource. They are not another application-wide tab bar.
- When Task 15 is implemented, the first observability entry will be
  `DIAGNOSE > Errors`. It remains hidden until it contains actual data and
  workflows.

### Page contracts for the live-test baseline

| Route/page | Required content and behavior | Explicitly not required yet |
| --- | --- | --- |
| **Workspace overview** | Active workspace name, honest project count/list, first-project/setup state, and links to Projects/Members. | Invented usage or customer metrics. |
| **Projects** | Accessible project list; create project for a product/environment; select/open project; clear empty state. | Cross-project aggregate analytics. |
| **Members** | Current organization members, role, invitations, and permitted actions through Better Auth. | Prism-managed team tables or invitation JWTs. |
| **Project overview** | Project/source context, date range, real counts for events/sessions/people, recent accepted activity, and a first-event state that links to the selected source setup. | Synthetic charts, error health, or fake live counts. |
| **Events** | Server-authorized, project-scoped event list with date range, event-name and source filters; event detail shows timestamp, trusted source/platform metadata, identity/session references where allowed, and sanitized properties. | Arbitrary query builder or raw unredacted payloads. |
| **People** | Project-scoped people list and person profile with known identifiers/traits and event timeline; existing export/delete rights remain visible only to authorized roles. | Cross-project profiles or a new CRM. |
| **Live** | Persistent connection-state text, live activity list, source/platform, and a safe reconnect state. Its Map view shows aggregate/coarse geography only when IP enrichment is available; the activity list remains usable without a map token. | A map as the only representation of data, per-user precision, or a claim about where an app binary was installed. It describes where sessions/events were observed. |
| **Sources** | List source name/platform/key health/last telemetry; create source; source detail with setup snippet, exact web allowed origins, current/revoked keys, one-time reveal, rotation, and last-seen health. | A generic shared key screen or exposing a secret server key to the browser. |
| **Project settings** | Project name/metadata, authorized destructive delete flow, and links to source/data-control configuration when implemented. | Workspace membership management or source keys. |

Every one of these pages must have loading, empty, error, and unauthorized
states. An empty successful result must not masquerade as a zero while a
request is loading.

## Readiness checklist

### 0. Freeze the first-live-test boundary

- [ ] **Deferred (hosted pass):** record the hosted-platform test environment
      name, hosted Prism web origin, hosted analytics ingest origin, and
      separate public React fixture origin. Use isolated test data and
      infrastructure that mirrors the hosted architecture.
- [ ] Choose a workspace/project/source naming convention for the run, for
      example `Prism live test` → `React web - staging` → `React web`.
- [ ] Confirm the test application contains no real customer data, secrets, or
      personally identifying test properties.
- [ ] Record the supported browser/runtime matrix for this run and the exact
      React/Vite versions used by the external fixture.
- [ ] Freeze the initial sidebar above and the page contracts below before
      changing layout code. Any new route needs a corresponding data/API
      contract, not only a visual placeholder.

### 1. Close the required Task 13 boundaries

- [x] Reconcile Task 13's remaining focused verification evidence: migration
      review, final affected checks, and proof that deletion/access removal
      invalidates keys and live subscriptions.
- [ ] Verify the deployed schema includes Better Auth organizations,
      `projects.organization_id`, `project_sources`, source-bound keys, and
      trusted source/platform storage on analytics records.
- [ ] Verify source creation makes the correct key type for every supported
      platform, and that source setup never emits a client-visible secret key.
- [ ] Verify one publishable Web source accepts the fixture's exact configured
      HTTPS origin and rejects a different origin before accepting telemetry.
- [ ] **Deferred (hosted pass):** verify source key rotation and revocation
      using the deployed analytics service, not only a controller test.
- [ ] **Deferred (hosted pass):** verify WebSocket subscription authorization
      after workspace switching, membership removal, and project deletion.

### 2. Finish the public SDK contract

- [ ] Apply and test the `projectKey` → `sourceKey` contract correction
      described above without weakening Task 9's validation, consent,
      persistence, queueing, idempotency, or identity guarantees.
- [ ] Ensure Core remains runtime-neutral and has no browser globals,
      React imports, or package-compiled endpoint.
- [ ] Ensure Browser remains the sole browser-runtime adapter: authenticated
      keepalive delivery, lifecycle hooks, storage behavior, and browser
      request context belong there, not in Core or React.
- [ ] Keep React a thin adapter over an already-ready Core/Browser client.
      Validate provider/hook behavior under Strict Mode and prove that no
      duplicate event, session, listener, or queue is created.
- [ ] Define one supported initialization and cleanup recipe for SPA roots.
      If an async bootstrap helper is added, test its loading/failure path and
      client ownership rather than hiding initialization inside render.
- [x] Preserve explicit consent as the collection gate. The fixture must prove
      both a granted flow and a denied/revoked flow without persistent identity
      leakage.
- [x] Confirm all public types, JSDoc, errors, package exports, and generated
      setup snippets use source terminology consistently.

### 3. Produce installable package artifacts

- [x] Build `@prism-analytics/core`, `@prism-analytics/browser`, and `@prism-analytics/react` from clean
      workspaces and inspect each package's published-file manifest/exports.
- [x] Pack the three packages and install those tarballs into a separate React
      fixture directory. The fixture must not resolve source files through
      monorepo workspaces, aliases, or symlinks.
- [x] Verify the packed packages contain their runtime code and declaration
      files, have correct peer dependencies, and do not include development
      paths or test-only imports.
- [x] Verify a production build of the fixture succeeds and its browser bundle
      contains neither a secret key nor a hardcoded Prism endpoint.
- [x] Add a consumer-level smoke test that imports the public packages exactly
      as the fixture does. Keep package-level unit tests focused; do not
      replace the external-install check with a monorepo test.

### 4. Build the disposable React fixture

- [x] Create a deliberately small, separately installed React application for
      this task. Keep its source/configuration outside the packages being
      tested and treat it as a consumer, not a product feature.
- [x] Configure only `VITE_PRISM_SOURCE_KEY` and
      `VITE_PRISM_INGEST_URL`-style public build values appropriate for a
      publishable Web source. Never put a server secret in the fixture.
- [x] Initialize one Browser client before rendering the provider. Render a
      clear SDK initialization failure state rather than silently running with
      tracking disabled.
- [x] Add visible, intentional controls that send stable test events such as
      `live_test_loaded`, `live_test_cta_clicked`, and `live_test_completed`.
      Include a bounded, non-PII property contract documented in the fixture.
- [x] Start a session intentionally and exercise `identify` after a clearly
      labeled test sign-in action, then `reset` after test sign-out.
- [x] Include a consent control that starts denied, grants collection, and
      withdraws it. Verify no event is queued/sent before collection is
      granted and that post-withdrawal behavior follows Task 10 semantics.
- [x] Exercise `flush` at a controlled completion point and surface a safe
      diagnostic outcome for the tester; do not expose raw server responses.

### 5. Make authenticated dashboard reads usable

- [ ] **Deferred (hosted pass):** complete auth/session bootstrap for the
      deployed web app, including sign-up or first-owner flow, sign-in,
      sign-out, active-workspace switch, and an unavailable-network state.
- [ ] Make route guards preserve the intended destination after auth and move
      focus to the page title after navigation.
- [ ] Wire Project overview to real, authorized analytics reads. Render an
      onboarding/empty state until the selected source sends its first event.
- [ ] Wire Events list/detail to the real persisted v2 events and trusted
      source context. Validate pagination/filter values at the API boundary.
- [ ] Wire People list/profile/timeline to the existing identity model without
      reimplementing or weakening Task 10's identity reconciliation rules.
- [ ] Wire Live Activity to an authorized WebSocket/read fallback with visible
      `Live`, `Reconnecting`, and `Offline` text states.
- [ ] Wire the Map local view only after activity works. It must fall back to
      the activity list when Mapbox or geo enrichment is unavailable.
- [ ] Wire Sources creation/detail/setup/key rotation to the Task 13 API and
      ensure setup code is generated from the actual SDK contract.

### 6. Implement the sidebar and route shell

- [ ] Build the 240px desktop sidebar and 1024px mobile/tablet sheet behavior
      specified in `engineering/design-system.md` using the initial navigation
      hierarchy in this task.
- [ ] Mark active page links with `aria-current="page"`; give the sidebar an
      accessible landmark label; preserve keyboard focus on sheet close and
      route transitions.
- [ ] Keep source/local tabs scoped to their resource and ensure desktop does
      not duplicate project navigation in a horizontal tab row.
- [ ] Validate desktop, tablet, and mobile layouts for long workspace/project/
      source names, no projects, no events, and no active source.
- [ ] Do not render future Analyze, Diagnose, Ship, Replay, Performance, or
      Logs links yet. The future IA is documented in the design system, while
      the live baseline stays honest.

### 7. Deploy the hosted live-test environment (deferred — pending future release pass)

- [ ] **Deferred (hosted pass):** deploy the hosted web app, hosted product
      API, hosted analytics API, database migrations, and WebSocket route
      together to the production-like test environment with HTTPS.
- [ ] **Deferred (hosted pass):** use dedicated hosted test databases/storage. Confirm the pre-launch
      migration reset policy cannot target an unrelated environment.
- [ ] **Deferred (hosted pass):** configure hosted CORS/proxy/routing so the
      public fixture reaches the hosted analytics ingest origin and the hosted
      dashboard reaches its authenticated API without a hidden same-origin
      development assumption.
- [ ] **Deferred (hosted pass):** set the Web source's allowed origins to the
      exact deployed fixture origin. Do not use `*` as a live-test shortcut.
- [ ] **Deferred (hosted pass):** run an equivalent hosted public-origin
      ingestion certification against this environment and record the
      command/result in this task. Do not
      substitute Task 13's deferred Docker/nginx self-hosted certification.
- [ ] **Deferred (hosted pass):** exercise browser unload/background
      delivery, retry after a transient network failure, and WebSocket
      reconnect on the deployed paths.
- [ ] **Deferred (hosted pass):** verify logs and diagnostics redact raw keys,
      cookies, authorization headers, and untrusted event properties.

### 8. Execute and record the live test (deferred — pending future release pass)

- [ ] **Deferred (hosted pass):** create the workspace, project, and Web
      source through the deployed UI.
- [ ] **Deferred (hosted pass):** install the packed packages in the separate
      fixture and configure the revealed publishable source key once. Record
      neither the raw key nor secrets in this task, screenshots, or test
      output.
- [ ] **Deferred (hosted pass):** generate the agreed anonymous event/session
      flow, identify the test person, generate another event, reset, and
      generate a fresh anonymous event.
- [ ] **Deferred (hosted pass):** confirm Events shows all accepted events in
      expected order with the correct source/platform; confirm
      duplicate/retry behavior does not inflate the event count.
- [ ] **Deferred (hosted pass):** confirm People shows the expected identity
      history and event timeline; verify consent changes do not restore a
      disallowed identity.
- [ ] **Deferred (hosted pass):** confirm Live Activity receives the test
      session/event and has a usable map/list fallback. If geo enrichment is
      enabled, validate only the approved coarse aggregation.
- [ ] **Deferred (hosted pass):** confirm Sources shows last-seen/health for
      the active source, rotate its key, prove the old key stops ingesting,
      and prove the replacement key works.
- [ ] **Deferred (hosted pass):** attempt the same fixture from a non-allowed
      origin and prove it cannot send accepted telemetry.
- [ ] **Deferred (hosted pass):** record exact versions/commit IDs, deployment
      addresses with secrets omitted, test accounts/resources cleaned or
      labelled, focused command results, and any defects in a completion log
      below.

## Completion criteria

- [ ] **Deferred (hosted pass):** a separately installed React application
      uses packed Core, Browser, and React packages to send real browser
      telemetry to the hosted Prism platform.
- [ ] The source-key model is the only public setup model: source key, explicit
      endpoint, trusted server-derived project/source/platform context.
- [ ] **Deferred (hosted pass):** a real user can authenticate, choose a
      workspace/project, configure a Web source, view real events/people/live
      activity, and rotate a source key through the web app.
- [ ] The initial sidebar contains only the routes and content contracts in
      this task; future observability navigation is reserved but not faked.
- [ ] **Deferred (hosted pass):** positive and negative live checks cover
      consent, wrong origin, key revocation, duplicate/retry behavior,
      membership authorization, and WebSocket connection state.
- [ ] The completion log records focused tests, package-install proof, hosted
      public-origin certification (deferred), and all defects/follow-ups
      without leaking keys.


### 2026-08-17 - Deploy-independent implementation landed; hosted pass deferred

- **§2 SDK contract (done):** `projectKey` → `sourceKey` renamed across
  `@prism-analytics/core`, `@prism-analytics/browser`, `@prism-analytics/react`, web setup snippets,
  onboarding, docs site (5 pages), the certification script, and every test
  fixture. No compatibility alias is carried (pre-launch). Deliberately
  retained internal names: storage-key derivation still embeds the key value
  in `prism:queue:*`/`prism:globals:`/`prism:identity:` key names (opaque,
  versioned); the internal field is `sourceKey` everywhere. `endpoint` stays
  explicit and runtime-configured; no `projectId`/`organizationId`/key-type/
  platform client options exist (asserted by the consumer smoke test).
  Package suites green: core 146, browser 32, react 13; docs drift OK.
- **§3 package artifacts (done):** clean tsup builds; tarballs contain only
  `dist` + `package.json` (verified via npm pack manifests); packed into
  `fixtures/task-14-react` via `file:` tarballs — real installs, no
  workspace/symlink resolution (verified). Fixture production build succeeds
  (193 kB bundle) and contains neither a `psk_`/`ssk_` key nor a hardcoded
  Prism endpoint (only React's own error-doc URLs). Consumer smoke test
  (`npm run smoke`) passes 8/8: exports present, packed types use
  `sourceKey` only, fixture passes only `sourceKey` + `endpoint`.
- **§4 fixture (done, code-level):** `fixtures/task-14-react` — one Browser
  client created before render, visible initialization-failure state,
  denied-by-default consent with grant/withdraw controls, stable test events
  (`live_test_loaded`, `live_test_cta_clicked`, `live_test_completed`),
  bounded non-PII property contract documented in the fixture README,
  session/identify/reset controls, flush control, safe diagnostics panel,
  StrictMode provider with explicit pagehide shutdown.
- **§1 Task-13 boundary (done at the focused level):** new real-store
  integration test `deletion-invalidates.test.ts` proves project deletion
  cascades sources+keys, the same publishable key is rejected by the real
  AnalyticsMiddleware afterwards (401), and the WebSocket connect
  authorization finds no project/membership rows. In-flight socket teardown
  on deletion + deployed rotation/revocation stay in the deferred hosted
  pass.
- **§7/§8 + hosted-only checks:** explicitly deferred to the future release
  pass (marked `**Deferred (hosted pass)**` in the task), per the owner's
  standing instruction to keep deployment/certification work pending.

## Completion log

Add dated entries here as work lands. Do not mark this task complete from unit
tests alone; it closes only after the hosted end-to-end journey succeeds.
