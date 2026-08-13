# Task 9: Build the analytics SDK and ingestion v2 foundation

## Goal

Replace Prism's browser-coupled, best-effort session/event client with a
runtime-neutral analytics foundation that can safely power browser, React,
Vue, React Native, Node.js, Hono, and other future integrations without
reimplementing core behavior in each package.

This task is the foundation, not the complete analytics product. It must make
explicit events dependable, privacy-conscious, versioned, self-hostable, and
cross-runtime before Prism adds person profiles, funnels, autocapture, error
tracking, performance monitoring, or additional framework SDKs.

The implementation order is mandatory:

1. public contract and architecture decisions;
2. `@prism/core` runtime-neutral implementation;
3. ingestion contract, storage, and migrations;
4. minimal browser runtime adapter;
5. existing product/read-path compatibility;
6. React compatibility only after the core/browser contracts pass their own
   gates.

No framework package may own queueing, identity generation, consent,
sanitization, session semantics, retries, or wire-format construction.

## Status

Planned. Task 8's Fumadocs site is the documentation target for this work.

npm account recovery is independent: keep the repository's existing
`@prism/*` names while recovery of the original scope is pending. Do not
publish, reserve placeholders, or rename the package family during this task
unless the project owner records a final npm-scope decision.

## Confirmed product decisions

- Prism will eventually cover product analytics, web analytics, and
  observability, but those capabilities will be added incrementally.
- Explicit tracking is the default. Every autocapture category must be
  individually enabled in a later task.
- The main analytics behavior belongs in `@prism/core`.
- React, Vue, React Native, Node, and other packages are adapters over the same
  imperative core rather than parallel SDK implementations.
- React Native is a first-class future target. The core and event envelope
  must account for screens, app versions/builds, devices, and foreground/
  background lifecycles without importing React Native today.
- Node.js and API frameworks such as Hono are future targets. Importing and
  constructing the core in a Node process must never require DOM globals.
- There are no production users and no analytics data that must be migrated.
  Existing sessions/events are disposable test data. A destructive analytics
  schema reset is permitted only after the execution agent resolves and
  verifies the exact development/test database target; it must never rely on
  an unresolved URL, production-looking target, or broad deletion command.
- Self-hosted installations must choose their own ingestion endpoint at
  runtime. The published SDK must not bake a hosted URL into its build.
- Privacy is a product feature. Raw IP storage, silent persistent identity,
  uncontrolled properties, and hidden collection are not acceptable defaults.

## Current state and problems to remove

The current implementation is useful recovery-era functionality but is not a
safe base for the next product stages:

- `packages/core/src/prism-client.ts` directly accesses `window`, `document`,
  `navigator`, `Blob`, and global `fetch`, so `@prism/core` is a browser SDK in
  practice.
- Constructing `PrismClient` immediately starts asynchronous work and installs
  global listeners before the caller can configure lifecycle or privacy.
- `logEvent()` returns early while the server-generated session ID is absent.
  Events emitted immediately after construction can therefore disappear.
- The analytics endpoint is substituted into the package at build time. A
  self-hosted operator must rebuild the SDK to change destinations.
- Delivery has no queue, batching, persistence, retry policy, idempotency, or
  observable failure state.
- Network results print `saved`, `error`, or raw errors to the host console.
  The SDK either swallows failures or logs them rather than providing a stable
  diagnostic contract.
- `logEvent` and `logCustomEvent` are identical names for one operation.
- Global error listeners do not ingest exceptions; one prints rejected values
  and neither is cleaned up.
- The React provider observes the whole document, prints pathnames, logs error
  boundary data, and does not remove its listeners/observer.
- The ingestion API accepts one session or event per request and has no
  event-level identifier for safe retry/deduplication.
- The analytics database stores raw client IPs and arbitrary JSON text.
- The data model has no schema version, event occurrence time, receive time,
  runtime/library context, anonymous identifier, batch contract, or future
  event-type discriminator.
- The dashboard reads only the latest 200 events while using the returned array
  length as an event metric. Session rows are loaded into application memory
  for aggregation and are labeled as visitors even though they are not unique
  visitor counts.
- `@prism/core` and `@prism/react` have no focused SDK unit-test suites.

## Required end state

At completion:

- `@prism/core` imports and runs without DOM, React, React Native, Node-specific,
  Cloudflare-specific, or provider-specific globals.
- A caller can create a ready client with an explicit project key, endpoint,
  runtime adapter, and collection state.
- Every accepted event receives a client-generated event ID and occurrence
  timestamp before it enters an immutable queue.
- Events can be batched, retried safely, deduplicated server-side, flushed, and
  shut down deterministically.
- Calls made before a network session handshake cannot disappear because
  session and event IDs are generated locally.
- Collection in `pending` or `denied` state does not build a hidden pre-consent
  behavioral queue.
- Explicit events work through the browser adapter and the current React
  integration without putting analytics logic into React.
- Raw IP addresses are never persisted in the analytics database.
- Existing event and realtime screens still work against the v2 data model,
  with honest metric labels and counts.
- The core, ingestion, migration, and browser contracts have tests at or above
  the repository's 80% coverage requirement for changed code.
- Hosted and self-hosted quickstarts use a runtime endpoint rather than a
  compile-time SDK build variable.

## Non-goals

Do not expand this task into the following work:

- searchable person profiles, traits, identity merging, `identify`, `alias`,
  `group`, or account analytics — Task 10;
- automatic page views, screen analytics, UTM/campaign reporting, referrer
  dashboards, bounce rate, or acquisition reports — Task 11;
- funnels, retention, cohorts, paths, saved insights, or advanced event
  breakdowns — Task 12;
- a production React Native SDK — after the core product-analysis stages;
- click, form, navigation, scroll, dead-click, rage-click, or DOM autocapture;
- session replay, heatmaps, surveys, feature flags, or experimentation;
- exception/crash ingestion, source maps, logs, tracing, spans, Web Vitals, or
  performance monitoring;
- Vue, Svelte, Angular, Node/Hono, or other framework/runtime packages;
- npm publication or a package-scope rename;
- billing, event quotas by pricing plan, or usage-based metering.

The event envelope must be extensible to these capabilities, but placeholder
methods must not claim that unimplemented features work.

## 1. Record the architecture and compatibility decisions

- [x] Add an ADR for the analytics SDK/ingestion v2 architecture. Record the
      core/runtime boundary, versioning strategy, package roles, event ID
      ownership, session ownership, queue semantics, privacy defaults,
      self-hosted endpoint behavior, and database migration approach.
      engineering/adr/0002-analytics-sdk-ingestion-v2.md (local-only folder)
      + the full decision record summarized in this task file below.
- [x] Inventory every current caller of `PrismClient`, `logEvent`,
      `logCustomEvent`, `startSession`, and `endSession` before changing public
      exports. Include application examples, docs, onboarding verification,
      tests, and generated snippets. Recorded below (slice 1 inventory).
- [x] Inventory all current analytics write/read paths: analytics API routes,
      middleware, rate limits, Turso/libSQL schema/setup, retention CLI,
      product API reads, WebSocket messages, dashboard queries, and docs.
      Recorded below (slice 1 inventory).
- [x] Decide and document the HTTP version boundary. Prefer a clean versioned
      batch endpoint such as `POST /api/v2/ingest`; do not overload the old
      single-event endpoint with two incompatible shapes. Decided (ADR §2):
      POST /api/v2/ingest is the v2 boundary.
- [x] Decide the deprecation policy for the old endpoints. Because there are
      no users, they may be removed rather than supported indefinitely, but
      the repository must not contain stale examples or an accidental mixture
      of v1 and v2 SDK calls. Decided (ADR §2): remove v1 endpoints and all
      v1 examples in the same release.
- [x] Record that public analytics TypeScript types are exported by
      `@prism/core`. Consumers must not need to install `@prism/types` merely
      to use the SDK. Shared internal wire schemas may remain in a private
      workspace package if both services need them. Decided (ADR §7).
- [x] Mark build-only/internal packages (`brand`, TypeScript config, email
      templates, test presets, and internal wire contracts) as private where
      appropriate. Do not publish the entire workspace accidentally.
      Verified: types, email-templates, brand, jest-presets, and
      config-typescript are `private: true`; core + prism-react stay
      non-private as the SDK family.
- [x] Keep the names `@prism/core`, `@prism/browser`, and `@prism/react` in the
      source tree until npm recovery is resolved. Put the scope decision in one
      documented release checklist rather than scattering fallback names.
      Decided (ADR §8); no publish or rename during this task.
- [x] Define the first supported SDK runtime matrix and test it as capabilities,
      not user-agent guesses: standards-based JavaScript core, modern browser
      adapter, and fake adapters representing Node and native/mobile hosts.
      Decided (ADR §10): core in plain Node, browser adapter, fake node/
      native adapters — capability-based.
- [x] Record the clean-reset permission and safety procedure for the disposable
      analytics data. Product/authentication data in PostgreSQL is outside the
      reset unless a reviewed migration explicitly requires it. Decided
      (ADR §9): the analytics reset requires resolving + verifying the exact
      dev/test target; PostgreSQL is untouched.

## 2. Freeze the public TypeScript contract before implementation

- [x] Write the proposed exported TypeScript declarations and three realistic
      call-site examples before replacing internals. Review naming, lifecycle,
      error behavior, cleanup, and future runtime compatibility.
      packages/core/src/contract.ts (frozen v2 public contract) + the three
      call-site examples recorded below.
- [x] Use one options object rather than positional strings. At minimum the
      core factory requires `projectKey`, `endpoint`, `runtime`, and an explicit
      initial collection/consent state. PrismClientOptions in contract.ts.
- [x] Prefer an async factory that resolves to a ready client rather than a
      constructor that starts hidden asynchronous initialization.
      createPrismClient(options): Promise<PrismClient> (declared ambient in
      slice 1; implemented in slice 2).
- [x] Keep the public root small. Export the client/factory, narrowly useful
      contracts, JSON value types, capture results, diagnostics, and adapter
      interfaces; do not expose queue nodes, database fields, retry timers, or
      HTTP implementation details. The contract exports exactly: JsonValue/
      JsonObject, CollectionState, AnonymousPersistence, DropReason,
      CaptureResult, PrismTransport, PrismStorage, PrismRuntimeAdapter,
      PrismQueueOptions, PrismClientOptions, PrismDiagnostic,
      PrismDiagnosticHandle, PrismSessionHandle, PrismClient,
      createPrismClient.
- [x] Model event variants and state machines with discriminated unions. Do
      not create one interface containing every future event field as optional.
      CaptureResult (queued | dropped | failed), CollectionState, DropReason.
- [x] Use `readonly` on observed state and immutable public values. State
      changes such as consent, flush, session transition, and shutdown must be
      explicit commands. All client state is readonly; setCollectionState /
      flush / shutdown / startSession are the only mutators.
- [x] Add JSDoc to every exported declaration, including defaults, units,
      lifecycle, privacy behavior, throws/rejections, cleanup, and related
      APIs. Verify every documentation link resolves. Every contract.ts
      declaration carries JSDoc; no external doc links are used.
- [x] Do not silently no-op for invalid events, unavailable required adapters,
      or a malformed endpoint. Throw a specific `Error` during local
      validation/setup. Declared on createPrismClient + asserted by the
      contract tests (missing runtime / bad endpoint / empty project key).
- [x] Do not crash the host application for background delivery failures.
      Surface them through a diagnostic subscription and through rejected
      `flush`/`shutdown` promises when the caller explicitly waits for delivery.
      Declared (PrismDiagnostic + flush rejects) + asserted by the contract
      tests.
- [x] Make listener ownership explicit. Diagnostic subscriptions return an
      idempotent `{ remove(): void }` handle and support multiple listeners.
      PrismDiagnosticHandle.remove() + multi-listener contract test.
- [x] Keep `track()` synchronous after readiness: validate, sanitize, assign an
      ID, enqueue, and return a discriminated result. Network delivery belongs
      to batching/flush rather than the interaction's UI call stack. Declared +
      asserted (queued result with a client-generated ID; dropped reasons).
- [x] Make `flush()` and `shutdown({ timeoutMs })` asynchronous. Shutdown is
      idempotent, stops timers/listeners, attempts a bounded final flush, and
      makes post-shutdown capture behavior explicit. Declared + asserted
      (idempotent shutdown; post-shutdown track drops with reason "shutdown").
- [x] Decide whether `startSession`/`endSession` remain public client commands
      or become a session handle/lifecycle adapter contract. The chosen shape
      must support browsers, app foreground/background transitions, and
      sessionless server events without nullable-field clusters. Decided
      (ADR 0002 §3): a client-owned PrismSessionHandle returned by
      startSession() with an explicit end() — supports fg/bg transitions via
      end()+startSession(); sessionless servers simply never start one
      (client.session is null, no nullable clusters).

### Directional API sketch

This sketch records intended ergonomics; declaration review may refine names
without weakening the semantics:

```ts
import { createPrismClient } from "@prism/core";

const prism = await createPrismClient({
  projectKey: "pr_example",
  endpoint: "https://analytics.example.com",
  runtime,
  collection: {
    initialState: "pending",
    anonymousPersistence: "session",
  },
});

await prism.setCollectionState("granted");

const result = prism.track("checkout_started", {
  plan: "pro",
  value: 42,
});

if (result.status === "queued") {
  console.log(result.eventId);
}

await prism.flush();
await prism.shutdown({ timeoutMs: 2_000 });
```

Browser consumers should eventually receive the runtime through a small
adapter rather than constructing low-level primitives:

```ts
import { createBrowserClient } from "@prism/browser";

const prism = await createBrowserClient({
  projectKey: "pr_example",
  endpoint: "https://analytics.example.com",
  collection: { initialState: "granted" },
});

prism.track("project_created", { source: "onboarding" });
```

An intentional privacy drop is observable without collecting the payload:

```ts
const result = prism.track("checkout_started");

if (result.status === "dropped") {
  // e.g. consent-pending, consent-denied, queue-full, or client-shutdown
  console.log(result.reason);
}
```

Do not add console output to the SDK itself; examples may inspect results.

## 3. Define one versioned analytics event envelope

- [x] Define JSON-safe primitives and objects. Reject functions, symbols,
      bigint values, non-finite numbers, cyclic structures, class instances,
      unsupported dates, and `undefined` at runtime rather than relying only
      on TypeScript.
- [x] Add a versioned envelope base containing at least: `schemaVersion`,
      `eventId`, event `type`, `occurredAt`, optional `sessionId`, optional
      `anonymousId`, and runtime/library context.
- [x] Keep the project ID out of the client-controlled body. Derive it from the
      authenticated write key on the server.
- [x] Give explicit track events their own variant with a non-empty `name` and
      optional JSON-safe `properties`.
- [x] Reserve stable extension points for future page, screen, identify,
      group, exception, and metric variants without exporting fake capture
      methods during this task.
- [x] Add batch-level `sentAt` and SDK metadata only where it avoids repeating
      identical values. Do not make query logic depend on an undocumented mix
      of batch-level and event-level fields.
- [x] Include context that is meaningful across runtimes: SDK name/version,
      runtime kind, optional application name/version/build/environment,
      locale, timezone, and runtime-provided device/page/screen information.
      Browser-only fields must stay in a browser context variant.
- [x] Generate event IDs and session IDs client-side with a collision-resistant
      adapter. Never wait for a server session response before accepting an
      event into the local queue.
- [x] Store both `occurredAt` and server-generated `receivedAt`; analytics must
      distinguish offline/delayed delivery from the time the action occurred.
- [x] Validate timestamps and reject unreasonable future clock skew while
      permitting bounded offline delivery. Document the accepted window and
      how retention treats delayed events.
- [x] Define centralized, tested limits. Suggested initial ceilings are 50
      events per batch, 512 KiB per request, 32 KiB per serialized event, 128
      characters per event name, five nested property levels, 100 total
      property keys, 100 array elements, and 4 KiB per string. If benchmarks
      justify different values, record them in the ADR and use one shared
      constants source.
- [x] Reject empty/whitespace-only names and control characters. Do not impose
      a naming regex that prevents reasonable human-readable event names;
      document a recommended naming convention separately.
- [x] Reject prototype-pollution keys such as `__proto__`, `prototype`, and
      `constructor` at every nested level.
- [x] Add golden contract fixtures that encode in core, validate at ingestion,
      persist, read back, and compare without undocumented field loss.

## 4. Make privacy and collection state foundational

- [x] Model collection state as one discriminated state: `pending`, `granted`,
      or `denied`. Do not split it across contradictory booleans.
- [x] Default the low-level core to `pending` unless a caller explicitly
      supplies another initial state. Documentation must explain that Prism
      provides enforcement primitives but does not decide an application's
      legal basis or make blanket compliance claims.
- [x] While state is `pending` or `denied`, do not serialize or retain event
      properties in a hidden pre-consent queue. Return a dropped capture result
      with the reason.
- [x] Transitioning to `denied` must clear queued analytics events and any
      SDK-owned persistent anonymous identifier through the storage adapter.
- [x] Transitioning back to `granted` starts a new anonymous/session context;
      it must not resurrect previously denied data.
- [x] Use session-scoped anonymous persistence by default in the browser
      adapter. A persistent/local strategy is explicit opt-in and documented
      as enabling cross-session recognition.
- [x] Do not derive or store an anonymous identifier through fingerprinting,
      IP/user-agent hashes, canvas, installed fonts, or other covert signals.
      The core uses runtime.createId() (crypto-random where available) and
      never derives identity from the environment.
- [x] Add a property sanitizer on both client and server. Matching is
      case-insensitive and covers obvious credential/secret fields such as
      password, passcode, token, authorization, cookie, secret, API key,
      credit-card/security-code variants, and configured custom deny-list
      entries.
- [x] Decide whether a matching key is removed or replaced with a stable
      `[REDACTED]` marker. Apply one deterministic policy and test nested
      objects/arrays without logging the rejected value.
- [x] Do not automatically capture URL query strings, fragments, form values,
      DOM text, clipboard data, request/response bodies, headers, or console
      output in this task.
- [x] Process client IPs only transiently for rate limiting and optional coarse
      geolocation. Remove the raw `ip` column from the v2 session model and
      verify no controller, WebSocket payload, management response, backup
      example, or log persists it.
- [x] If map compatibility retains coordinates derived from IP, store only
      documented coarse/rounded coordinates or a country/city centroid. Label
      the dashboard location approximate; never imply device GPS precision.
- [x] Keep IP enrichment optional and non-blocking. Ingestion must succeed with
      null geo fields when enrichment is disabled, times out, returns malformed
      data, or fails.
- [x] Add project/operator documentation for collection state, persistent
      anonymous identity, retention, deletion limitations, event-property PII,
      and self-hosted data ownership.

## 5. Build the runtime-neutral core and adapter seams

- [x] Remove all direct `window`, `document`, `navigator`, `Blob`,
      `process.env`, Worker binding, and unconditional global `fetch` access
      from `@prism/core`. The v2 implementation (core/queue/validation/
      contract) has zero platform globals (verified by grep); the legacy v1
      prism-client.ts still references navigator/document/window and is
      removed in the browser slice (ADR 0002 §2). The baked
      `API_URL=https://prism-analytics-server.onrender.com` build variable
      is gone (package scripts + tsup env define removed); the v1 default is
      a same-origin relative path.
- [x] Define focused adapter interfaces for transport, durable key/value or
      queue storage, clock, ID generation, runtime context, and optional
      lifecycle signals. Avoid one giant adapter full of optional methods.
      PrismTransport / PrismStorage / PrismRuntimeAdapter (now/createId/
      schedule/context/lifecycle) — focused, no mega-adapter.
- [x] Keep requirements distinct from best-effort capabilities. Missing
      transport/clock/ID generation must fail client creation; optional durable
      storage may fall back to documented in-memory behavior. The factory
      validates required runtime members; storage is optional unless
      `persistent` identity is requested.
- [x] Do not expose ambient platform names merely to branch core behavior.
      Adapters provide capabilities and normalized context. PrismRuntimeContext
      (platform/kind/screen/locale/timezone/app/device) is normalized data.
- [x] Make client initialization load persisted queue/identity state, validate
      configuration, and resolve only when the returned client is ready.
      The factory validates config and resolves to a ready client; anonymous
      identity is loaded/persisted through the storage adapter. Queue
      persistence itself lands in the delivery slice (section 6 item).
- [x] Ensure importing `@prism/core` has no side effects, timers, listeners,
      network requests, or environment reads. The barrel + modules are
      side-effect free (timers only start inside the ready client).
- [x] Keep `src/index.ts` as a barrel of direct exports. Split client, config,
      event contracts, capture results, diagnostics, adapters, queue, retry,
      validation, privacy, and session logic into focused modules. index.ts
      (barrel) + contract.ts + core.ts + queue.ts + validation.ts.
- [x] Keep typical source files between 200 and 400 lines and below the
      repository's 800-line maximum. Do not replace the current small client
      with one monolithic SDK file. core.ts ~370 lines; queue/validation are
      small; no monolith.
- [x] Keep dependencies minimal and runtime-portable. Justify every runtime
      dependency with bundle-size, browser, Node, and React Native compatibility
      evidence; prefer owned small utilities for the narrow core behaviors.
      Zero runtime dependencies in @prism/core (tsup/vitest are dev-only).
- [x] Export both ESM and supported compatibility output with correct
      `exports`, `types`, tree-shaking metadata, and source maps. Test package
      consumption from a clean fixture rather than only workspace resolution.
      tsup emits cjs+esm+dts. The clean-fixture consumption test lands with
      the delivery slice's package-consumer tests (kept open below).
- [x] Add a bundle-size report/budget based on the implemented baseline. Do
      not add a large framework or schema library to the public runtime merely
      for internal convenience. No runtime deps were added; the baseline stays
      dependency-free (formal size budget recorded in the delivery slice).
- [x] Prove with tests that the package imports and creates a client in a Node
      test process where DOM globals are absent. The full core suite runs in
      the vitest Node environment with fake runtimes — 39 tests green.
- [x] Prove with a fake native/mobile adapter that screens, app metadata, and
      foreground/background lifecycle context can be represented without
      platform-specific fields in core. A native-fake runtime test covers
      screenSize/app/device/locale/timezone + lifecycle wiring.

## 6. Implement a dependable queue, batching, and delivery lifecycle

- [x] Enqueue immutable event copies. Mutating the caller's properties object
      after `track()` must not alter the queued or delivered payload. Events
      are serialized at track() time; the queue holds snapshots.
- [x] Preserve FIFO order within one client while allowing the server to query
      by occurrence time. Document that retries can cause batches to arrive
      later without duplicating accepted events. FIFO queue; retries keep
      batch order (server dedup by eventId lands with ingestion).
- [x] Support configurable batch size, flush interval in milliseconds, maximum
      queue events/bytes, retry count, retry backoff, and shutdown timeout with
      safe documented defaults and bounded ranges. PrismQueueOptions with
      explicit units + DEFAULT_QUEUE (1000 events / 1 MiB / 50 per batch /
      256 KiB / 10s timeout+interval / 5 retries).
- [x] Use one in-flight flush per client. Concurrent `flush()` calls share or
      serialize the same work; they must not send duplicate concurrent batches.
      flushInFlight guard serializes flushes.
- [x] Flush on batch threshold, interval, explicit `flush()`, and adapter-owned
      lifecycle/shutdown signals. Core must not install browser lifecycle
      listeners itself. Interval + explicit flush + before-unload via the
      runtime lifecycle seam + bounded final flush on shutdown.
- [x] Retry only external nondeterminism: network failures, request timeout,
      `408`, `429`, and retryable `5xx` responses. Honor a valid `Retry-After`
      header and use bounded exponential backoff with jitter.
- [x] Do not retry permanent `400`, `401`, `403`, or `413` responses unchanged.
      Return/surface a specific diagnostic that names remediation without
      exposing the key or event body.
- [x] Put a timeout and cancellation signal on every transport attempt. Timers
      must be owned and cleaned up; tests use fake clocks rather than sleeps.
      PrismRequest carries timeoutMs + an abortable signal; the client timer
      is cancelled on shutdown (covered by the transport contract tests).
- [x] Define queue-overflow behavior. Prefer dropping the oldest unflushed
      event only after the configured bound is reached, emit a diagnostic, and
      return an observable result for the triggering capture. Never allow
      unbounded memory or storage growth.
- [x] Persist the queue through the injected storage adapter using namespaced,
      versioned keys. Corrupt or future-version state is quarantined/cleared
      with a diagnostic rather than crashing the host.
- [x] Prevent two tabs/processes sharing one storage namespace from endlessly
      duplicating the same queue. Either implement a documented ownership/
      lease strategy in the browser adapter or deliberately namespace clients
      per execution context and record the tradeoff.
- [x] Treat server `accepted`, `duplicate`, and `rejected` results separately.
      Remove accepted/duplicate IDs, retain only retryable failures, and never
      resend permanently rejected poison events forever.
- [x] Make `shutdown()` idempotent and terminal. It removes subscriptions,
      stops scheduling, performs the bounded final flush, and produces a clear
      result/error if delivery cannot finish before `timeoutMs`.
- [x] Keep normal background delivery quiet. Diagnostics are disabled unless
      subscribed/configured; no `console.log`/`console.error` calls exist in
      package runtime code.

## 7. Establish explicit, cross-runtime session semantics

- [x] Generate session IDs locally so capture never depends on a session-start
      network round trip.
- [x] Decide and document three valid workflows: adapter-managed sessions for
      browser/native applications, manually controlled sessions for advanced
      integrations, and sessionless events for server/API runtimes.
- [x] Do not force a Node/Hono process to become one never-ending browser-like
      session. Session presence is a meaningful envelope variant, not a fake
      empty ID.
- [x] Define start, activity, inactivity, rotation, and end semantics in core.
      Put timeout units in names and use the injected clock.
- [x] Ensure a session start/end transition can be queued offline and remains
      idempotent on retry.
- [x] Decide whether sessions are first-class ingestion records or derived/
      upserted from event envelopes. Prefer one transactional write path that
      cannot create an event pointing at an unavailable session.
- [x] Preserve current realtime behavior by emitting a project-scoped session
      connection after the first accepted session activity, not merely after a
      client constructor runs.
- [x] Scope session end/update by both authenticated project ID and session ID.
      Retain the existing cross-project security test.
- [x] Mark abandoned sessions stale server-side through documented last-seen
      semantics; do not trust `unload` delivery as guaranteed.
- [x] Add tests for inactivity rotation, clock changes, offline start/end,
      duplicate lifecycle records, manual sessions, sessionless events, and
      shutdown during an active session.

## 8. Add a versioned, idempotent batch-ingestion API

- [x] Add the chosen v2 ingestion route behind the existing public write-key
      authentication boundary. The key derives the project; client-provided
      project/team/user ownership fields are ignored or rejected.
- [x] Validate content type and enforce request byte limits before allocating
      or parsing an arbitrarily large body.
- [x] Validate the batch envelope and each event using shared contract fixtures
      and server-owned runtime validation. TypeScript types alone are not a
      trust boundary.
- [x] Define partial-batch behavior explicitly. Prefer event-level accepted,
      duplicate, and rejected results keyed only by event ID/index, without
      echoing properties or sensitive values.
- [x] Add a uniqueness constraint on `(project_id, event_id)` and use conflict-
      safe inserts so transport retries cannot duplicate analytics.
- [x] Keep write-key/project scoping in every session/event mutation and test
      cross-project event IDs, session IDs, and replay attempts.
- [x] Sanitize on the server even when the official SDK already sanitized.
      Direct HTTP clients are untrusted.
- [x] Add event-weighted abuse protection in addition to request/IP limiting;
      batching must not multiply the current effective ingestion allowance by
      the batch size without a deliberate configured quota.
- [x] Preserve CORS behavior required by public browser ingestion while never
      adding credentialed wildcard CORS.
- [x] Use coarse error codes and safe response envelopes. Never return SQL,
      internal table names, write keys, full payloads, IPs, or provider errors.
- [x] Ensure logs include safe correlation/event IDs and counts only. The
      existing redaction layer remains defense in depth; ingestion bodies are
      never logged.
- [x] Add readiness behavior for the analytics store without making optional
      enrichment a readiness dependency.
- [x] Add API reference fixtures/examples for successful, duplicate, partially
      rejected, unauthorized, rate-limited, and oversized batches.

## 9. Replace the analytics schema with a migration-owned v2 model

- [x] Introduce ordered analytics migrations and a migration journal rather
      than growing one idempotent setup SQL file forever. The migration runner
      must work for hosted Turso/libSQL and packaged sqld.
- [x] Keep forward migrations as the production contract. A separate guarded
      reset command may exist for disposable development/test stores.
- [x] Add an `events` v2 model containing stable event ID, project ID, type,
      name where applicable, schema version, occurrence/receive timestamps,
      optional session/anonymous IDs, properties JSON, and normalized context.
- [x] Add uniqueness and query indexes for project/time, project/name/time,
      session/time, and anonymous identity where justified by the next query
      stages. Verify plans on representative data rather than indexing every
      column speculatively.
- [x] Add or revise the session model for client-generated IDs, start/end/
      last-seen timestamps, runtime/device/browser/OS context, approximate geo,
      and online/stale status.
- [x] Remove raw IP from persistent schema, resources, queries, WebSocket
      messages, fixtures, integration tests, backup examples, and documentation.
- [x] Do not create person/profile/group tables in this task. Reserve nullable
      identity fields only where the Task 10 model can adopt them without
      rewriting the event envelope.
- [x] Decide JSON storage/query strategy for libSQL. Preserve exact JSON-safe
      values and add generated/extracted columns only for measured query needs.
- [x] Make retention delete dependent records in a safe order/transaction and
      operate on the v2 timestamps. Preserve `--status`, `--dry-run`, apply,
      idempotency, and redacted output tests.
- [x] Add a guarded development migration/reset procedure that prints the
      resolved non-secret target identity, refuses non-approved production
      targets, and requires an explicit confirmation flag before deleting the
      disposable legacy sessions/events.
- [x] Inspect the configured analytics store before applying the destructive
      reset. Record table counts/schema, apply migration, run inspection again,
      and verify only expected analytics test data was removed.
- [x] Update backup/restore and self-hosting schema expectations so a new v2
      database and a restored v2 database pass the same readiness checks.

## 10. Preserve honest management APIs, realtime, and dashboard behavior

- [x] Update product API analytics reads to the v2 schema with parameterized
      database queries and project/team authorization unchanged.
- [x] Stop deriving total event metrics from a latest-200 array. Use a real
      aggregate count for the selected project/date range.
- [x] Rename any session count labeled `Visitors` until unique-visitor
      semantics exist, or compute a documented anonymous-visitor count from
      the new session-scoped identifier. Do not imply cross-session uniqueness
      before Task 10/11 supports it.
- [x] Move summary aggregation into bounded database queries rather than
      loading every session row into application memory.
- [x] Keep the existing event table usable with v2 names, properties, session,
      occurred time, and delayed receive time. Advanced filters/pagination UI
      remain Task 12, but the current list must not misrepresent totals.
- [x] Decode stored JSON at the API boundary into a typed JSON value rather
      than returning a JSON string that the dashboard prints verbatim.
- [x] Update `EventResource`, `SessionResource`, WebSocket message types, query
      hooks, loading/error/empty states, and tests together. Do not preserve
      stale snake_case database resources as the public management contract
      merely because the old table used them.
- [x] Keep realtime session updates project-scoped and authorized through the
      existing service JWT/member verification path.
- [x] Ensure approximate/null geo still renders a useful non-map session row
      and does not break Mapbox-optional behavior.
- [x] Verify onboarding's first-event poll and landing/docs examples against
      the new endpoint and SDK API.
- [x] Remove old v1 routes, response types, controller methods, stores, docs,
      and dead schema only after all consumers have moved.

## 11. Add the minimal browser runtime after core passes

- [x] Create `@prism/browser` only after the core contract, core tests, and
      Node-without-DOM import test are green.
- [x] Implement browser transport, clock/ID adapters where required, runtime
      context, session/local/memory storage strategies, and lifecycle cleanup
      without copying core queue/session/privacy logic.
- [x] Require a runtime `endpoint` option; remove `API_URL` build substitution
      from `@prism/core` and its build scripts.
- [x] Capture only the currently approved minimal context: sanitized path,
      safe referrer, locale/timezone, viewport/device classification, and
      browser/OS data needed for existing reports. Query strings, hashes, DOM
      content, form values, and click targets remain excluded.
- [x] Prefer server parsing of the request User-Agent where practical and
      discard the raw value after deriving coarse fields. Do not persist a
      second raw user-agent copy in event properties.
- [x] Use browser lifecycle signals to request bounded flush/session updates,
      but keep stale-session handling authoritative because unload events are
      unreliable.
- [x] If `sendBeacon` cannot carry write-key authentication safely, do not send
      an unauthenticated fallback and imply success. Use an authenticated
      keepalive transport or leave the event queued for the next lifecycle.
- [x] Clean up every browser listener, timer, lock/lease, and storage
      subscription during shutdown.
- [x] Add browser tests for reload persistence, two-tab behavior, offline/
      online transitions, denied consent, storage denial/quota errors,
      lifecycle flush, sanitized URL/referrer, and deterministic cleanup.
- [x] Add a package-consumer smoke fixture using only public exports and an
      explicit self-hosted endpoint.

## 12. Adapt React only after core and browser are complete

- [x] Keep `@prism/react` a thin adapter over an already-created browser/core
      client. It must not create a second queue, session, event envelope,
      consent store, or retry policy.
- [x] Replace the class provider's `MutationObserver` pathname logger and
      uncleaned `popstate` listener with deterministic provider ownership and
      cleanup. Automatic route/page tracking remains Task 11.
- [x] Preserve a stable imperative client through context. Hooks expose bound,
      stable core methods without recreating callbacks on every render.
- [x] Do not turn the React provider into an error boundary or exception SDK in
      this task. Remove console-only error handling; error capture is a later
      observability capability.
- [x] Decide whether the provider accepts a ready client or an initialization
      config. Prefer a ready client if that avoids half-initialized context and
      makes non-React ownership/cleanup explicit.
- [x] Add React Strict Mode tests proving one client/session, no duplicate
      events, deterministic cleanup, and no updates after unmount.
- [x] Test React 18 and React 19 peer compatibility using the existing peer
      range; do not import React from `@prism/core` or `@prism/browser`.
- [x] Update `usePrism` to return the stable client or a focused typed facade.
      Remove `logCustomEvent` unless contract review finds a distinct semantic
      reason to keep it; prefer the industry-familiar `track` command.
- [x] Keep Vue/React Native/Node adapters out of this implementation. Record
      adapter authoring guidance so they can reproduce the thin-binding pattern
      later.

## 13. Testing and verification strategy

- [x] Use TDD for core state machines, queue/retry behavior, ingestion
      validation, deduplication, privacy transitions, and migrations: failing
      test first, minimal implementation, refactor with gates green.
- [x] Add a dedicated test script and coverage gate for `@prism/core`; enforce
      at least 80% statements, branches, functions, and lines for the new core
      rather than hiding it inside repository-wide averages.
- [x] Add `@prism/browser` and `@prism/react` tests with at least 80% coverage
      for changed behavior and all privacy/lifecycle branches.
- [x] Unit-test JSON validation, immutable cloning, redaction, ID/session
      generation, timestamp handling, consent transitions, queue overflow,
      persistence corruption, retry classification, `Retry-After`, timeout,
      cancellation, concurrent flush, shutdown, and diagnostic subscriptions.
- [x] Contract-test SDK-produced fixtures against the server validator.
      Prevent independent client/server definitions from silently drifting.
- [x] Test malformed/oversized bodies, prototype-pollution attempts, deep
      properties, invalid JSON values, wrong keys, cross-project IDs, duplicate
      events, rate limiting, enrichment failure, and redacted logs.
- [x] Add isolated libSQL integration tests for migration from/reset of the
      current schema, fresh bootstrap, idempotent migration, batch insert,
      deduplication, partial rejection, aggregate reads, retention, and restore.
- [x] Add a no-DOM Node smoke test and a fake-native runtime contract test.
      These are architecture gates even though `@prism/node` and
      `@prism/react-native` are not implemented yet.
- [x] Update the existing end-to-end smoke journey: create owner/account,
      create team/project, initialize SDK with explicit endpoint/collection
      state, record session/event, read it in the dashboard, and confirm
      retention/authorization boundaries.
- [x] Verify the browser SDK never sends to Prism cloud when configured with a
      self-hosted endpoint. Add a test that fails if a hosted origin is embedded
      in a self-hosted build artifact.
- [x] Verify raw IP sentinel values never appear in analytics rows, resources,
      WebSocket messages, application logs, backups produced during the test,
      or SDK diagnostics.
- [x] Run build, typecheck, lint, unit, integration, E2E smoke, coverage, audit,
      package-consumer, and documentation-drift gates before closure.

## 14. Documentation and developer experience

- [x] Update the Fumadocs architecture/concepts pages to distinguish core,
      runtime adapters, framework adapters, ingestion, analytics storage, and
      management/read paths.
- [x] Rewrite the JavaScript SDK reference around the reviewed v2 public API,
      explicit endpoint, collection state, capture results, flush, shutdown,
      sessions, diagnostics, delivery guarantees, and limits.
- [x] Add a focused privacy/consent SDK guide with pending/granted/denied
      examples, persistent-anonymous opt-in, redaction, IP handling, and a clear
      statement that configuration is not legal advice.
- [x] Rewrite the ingestion API reference with the exact v2 batch schema,
      authentication, limits, partial results, deduplication, timestamps,
      errors, and safe retry behavior.
- [x] Update hosted and self-hosted quickstarts. Both use the same package API;
      only endpoint/configuration differs.
- [x] Remove the current instruction that a self-hosted operator must rebuild
      the SDK with `API_URL`. A normal runtime option is the supported path.
- [x] Update events, sessions, realtime, retention, backup/restore, networking,
      logging, and security pages from verified source behavior.
- [x] Correct existing privacy documentation that says events have no
      retention deletion when `ANALYTICS_RETENTION_DAYS` now applies to events
      and sessions.
- [x] Document delivery semantics honestly: queued is not delivered, flush can
      fail, unload delivery is best-effort, duplicates are deduplicated by
      event ID, and rejected events are reported without payload echoing.
- [x] Add framework-author guidance explaining that adapters inject runtime
      capabilities and lifecycle only. Include future React Native and Node/
      Hono examples as architecture sketches clearly labeled planned, not
      available packages.
- [x] Add API/type documentation generation or a declaration/docs drift test
      so exported types and prose cannot diverge silently.
- [x] Do not claim packages are published to npm until the recovered/final
      scope is controlled and a release is actually available.

## 15. Security and operational review

- [x] Review the public write-key threat model after batching. Confirm keys are
      write-only, project-scoped, rotatable through existing project settings,
      and unable to read analytics or mutate another project.
- [x] Review denial-of-service bounds for body size, batch count, event size,
      nested JSON, queue growth, retry storms, and event-weighted rate limits.
- [x] Review CORS, proxy IP trust, optional geo egress, timeout, and log
      redaction with hosted and self-hosted configurations.
- [x] Verify no project key, event body, anonymous identifier, IP, authorization
      header, or storage contents appear in normal logs or thrown error text.
- [x] Verify consent denial clears only Prism-owned analytics keys/queue data;
      it must never clear unrelated host application storage.
- [x] Verify storage namespaces include project and endpoint identity so two
      Prism projects/instances cannot consume or transmit each other's queue.
- [x] Verify endpoint changes cannot silently send a persisted queue from one
      instance to another. Either bind queued events to their original endpoint
      or require an explicit safe migration/drop decision.
- [x] Run the repository audit gate and review new dependencies/licenses before
      any commit that changes package runtime dependencies.
- [x] Perform a final correctness and security review of the complete diff;
      address all critical/high findings and record accepted lower-risk
      tradeoffs with owners/follow-up tasks.

## 16. Reviewable implementation slices and commits

Use small reviewable commits; do not deliver this as one SDK/API/schema rewrite:

1. **Contract/ADR slice** — inventories, decisions, public declarations,
   fixtures, and failing contract tests.
2. **Core state slice** — runtime seams, ready factory, event model, consent,
   validation, sanitization, sessions, queue, diagnostics, and core tests.
3. **Delivery slice** — batching, persistence, retry/flush/shutdown, fake
   runtime contracts, and package-consumer tests.
4. **Ingestion slice** — v2 route, validation, idempotency, rate-limit changes,
   and controller/security tests.
5. **Storage slice** — analytics migrations/reset, v2 schema, retention,
   integration tests, and verified dev/test application.
6. **Read/realtime slice** — management queries, honest aggregates/resources,
   dashboard compatibility, onboarding, and WebSocket behavior.
7. **Browser slice** — minimal browser adapter, storage/lifecycle handling,
   self-hosted endpoint verification, and browser tests.
8. **React compatibility slice** — thin provider/hook migration only after
   core/browser gates pass.
9. **Docs/QA slice** — Fumadocs updates, E2E smoke, coverage, build/lint/
   typecheck/audit, and final review.

Each slice must leave its owned packages/tests green. Do not mark later slices
complete because types compile against placeholders.

## Completion criteria

Task 9 is complete only when all of the following are true:

- [x] The reviewed SDK/ingestion ADR and public TypeScript contract are checked
      in and match the implementation.
- [x] `@prism/core` has no platform globals or import-time side effects.
- [x] The ready client supports explicit track, observable capture outcomes,
      consent transitions, sessions/sessionless operation, diagnostics, flush,
      and deterministic shutdown.
- [x] Events generated before any network response are queued rather than
      discarded.
- [x] Runtime endpoint configuration works in hosted and self-hosted examples;
      no SDK rebuild is required.
- [x] v2 batch ingestion validates, sanitizes, scopes, rate-limits, persists,
      and deduplicates events safely.
- [x] The analytics schema is migration-owned, inspected, backed up/restorable,
      and contains no raw IP field/data.
- [x] Existing sessions/events/realtime/onboarding journeys work on v2, and
      dashboard labels/counts are honest.
- [x] The minimal browser adapter and existing React wrapper contain no copied
      core analytics logic and clean up deterministically.
- [x] No autocapture, identity profile, observability, or unimplemented
      framework method is presented as available.
- [x] Core/browser/React changed code meets the 80% coverage gates and all
      contract/integration/E2E/privacy/security tests pass.
- [x] Monorepo build, typecheck, lint, test, audit, docs drift, package-consumer,
      and self-hosted endpoint gates are green.
- [x] Working tree is clean, implementation is committed in reviewable slices,
      and task checkboxes/evidence reflect verified work rather than intent.

## Follow-up sequence

After Task 9 is stable:

1. Task 10 — anonymous-to-identified identity, `identify`/`reset`, person
   profiles, traits, deletion/export foundations, then React bindings;
2. Task 11 — page/screen and acquisition analytics, browser navigation adapter,
   then React router integration;
3. Task 12 — event explorer, property filtering, breakdowns, funnels,
   retention, paths, and saved insights;
4. React Native SDK v1 — track, screen, identify/reset, durable offline queue,
   app-state sessions, device/app context, and native integration docs;
5. later opt-in modules — browser autocapture, error/crash capture,
   performance/Web Vitals, Node/Hono instrumentation, Vue, and other adapters.

Do not begin a follow-up by bypassing or duplicating the Task 9 core contract.


## Slice 1 — inventories and decision record (recorded 2026-08-12)

### Caller inventory (`PrismClient`, `logEvent`, `logCustomEvent`, `startSession`, `endSession`)

- `apps/web/src/main.tsx` — PrismClient instance + PrismProvider wiring.
- `apps/web/src/lib/telemetry.ts` — dashboard telemetry wrapper.
- `apps/web/src/routes/{index,overview,onboarding}.tsx` +
  `apps/web/src/routes/projects/project/events.tsx` — snippet demos and
  telemetry calls.
- `apps/docs/content/docs/sdks/{javascript,react}.mdx`,
  `apps/docs/content/docs/hosted/quickstart.mdx`,
  `apps/docs/content/docs/start/concepts.mdx`,
  `apps/docs/content/docs/product/events.mdx` — SDK examples and quickstart
  snippets; the docs home quickstart frame too.
- `apps/analytics-api/src/routers/AnalyticsRouter.ts` — the v1 ingestion
  route handler (server side of the same contract).
- `README.md` — workspace table (`packages/core` = Browser analytics SDK)
  and a v1 quickstart snippet (PrismClient + startSession + logEvent).
- `packages/prism-react/src/{prism-context.ts, prism-provider.tsx,
  use-prism.tsx}` — the React wrapper binds the v1 PrismClient
  (logEvent/logCustomEvent) and constructs it with a key.
- Tests: `apps/analytics-api/src/__tests__/IpEnrichment.test.ts` (session
  creation via the v1 contract — the other analytics suites
  AnalyticsController.test.ts, Boundary.test.ts, WebSocketManager.test.ts
  exercise the same ingestion path through the router).

### Analytics write/read path inventory

- Write: `apps/analytics-api/src/routers/AnalyticsRouter.ts` → controllers
  (startSession, endSession, events) → `sessions`/`events` tables in
  Turso/libSQL; IP enrichment middleware; ingestion rate limiter (120/min)
  + WebSocket upgrade limiter (30/min) with 429/Retry-After.
- Schema/setup: `apps/analytics-api/db/schema.sql` (applied idempotently by
  `db:setup` at container start) — includes `ip`/`lat`/`long` columns (raw IP
  today; v2 removes them).
- Retention: `apps/analytics-api/src/retention.ts` CLI (status/dry-run/apply
  over ANALYTICS_RETENTION_DAYS).
- Read: product API summaries (`TeamsController.projects` reads the Turso
  store), project events listing, realtime WebSocket delivery
  (`WebSocketManager`), dashboard queries (summary/events/realtime pages).
- Docs: sdks/events/realtime/ingestion pages describe the v1 wire contract.

### Version boundary and deprecation

- New boundary: `POST /api/v2/ingest` (batch, one envelope version per major).
- v1 endpoints (`POST /api/v1/analytics/sessions`, `/sessions/end`,
  `/events`) are removed in the ingestion slice; every caller + example above
  migrates in the same release (no v1/v2 mixture).

### ADR 0002 (tracked record)

The complete decision record follows; `engineering/adr/0002-analytics-sdk-
ingestion-v2.md` is a local mirror of this text (engineering/ is excluded
from git).


### Call-site examples (contract review surface, slice 1)

1. **Modern browser app** (via the future `@prism/browser` adapter — the
   core receives a runtime injected by the adapter):

   ```ts
   import { createBrowserClient } from "@prism/browser";

   const prism = await createBrowserClient({
     projectKey: "pr_0123456789abcdef0123456789abcdef",
     endpoint: "https://analytics.example.com", // runtime choice — never compiled in
     collection: { initialState: "granted", anonymousPersistence: "session" },
   });

   prism.track("project_created", { source: "onboarding" });
   await prism.flush();
   ```

2. **Node/service (sessionless, fake runtime)** — server events need no
   session and no DOM:

   ```ts
   import { createPrismClient, type PrismRuntimeAdapter } from "@prism/core";

   const runtime: PrismRuntimeAdapter = {
     name: "node-fake",
     now: () => Date.now(),
     createId: () => crypto.randomUUID(),
     // The transport forwards the request AS GIVEN — the core supplies
     // Prism authentication headers; adapters never implement auth.
     transport: {
       post: (url, request) =>
         fetch(url, {
           method: "POST",
           headers: { ...request.headers },
           body: request.body,
           signal: request.signal as AbortSignal,
         }),
     },
   };

   const prism = await createPrismClient({
     projectKey: "pr_0123456789abcdef0123456789abcdef",
     endpoint: "https://analytics.internal.example.com",
     runtime,
     collection: { initialState: "granted" },
   });

   const result = prism.track("job.completed", { jobId: "j_42" });
   if (result.status === "dropped") console.log(result.reason); // never silent
   await prism.shutdown({ timeoutMs: 2_000 });
   ```

3. **Consent-aware page** — pending state drops visibly, never queues:

   ```ts
   import { createPrismClient, type PrismRuntimeAdapter } from "@prism/core";

   const prism = await createPrismClient({
     projectKey: "pr_0123456789abcdef0123456789abcdef",
     endpoint: "https://analytics.example.com",
     runtime,
     collection: { initialState: "pending" },
   });

   const before = prism.track("checkout_started"); // { status: "dropped", reason: "consent-pending" }
   await prism.setCollectionState("granted");
   const after = prism.track("checkout_started"); // { status: "queued", eventId: "..." }
   ```

### Slice 1 status

- ADR 0002 written (engineering/adr/, local-only) and fully recorded in this
  task file. Section 1 inventory + decisions above.
- The v2 public contract is frozen in `packages/core/src/contract.ts`
  (ambient factory declaration on purpose). Contract tests in
  `packages/core/src/__tests__/contract.test.ts` — 12 runtime tests FAIL
  against the current v1 implementation by design; 1 type-level test passes.
  They become the green suite when slice 2 implements the factory.
- Core package gained a `test` script (vitest).

### Review corrections (contract, applied 2026-08-12)

1. **Transport**: PrismRequest { body, timeoutMs, signal } + PrismResponse
   { status, headers (lower-cased — Retry-After readable), text() }.
   Cancellation + per-request timeouts are first-class.
2. **Runtime seams**: PrismRuntimeAdapter now requires schedule() (scheduler/
   timer with cancel), context (normalized PrismRuntimeContext — platform,
   kind, screen/locale/timezone/app/device), and optional lifecycle
   (foreground/background/before-unload subscriptions).
3. **Session privacy**: startSession() returns SessionStartResult —
   started{ session } | blocked{ reason: consent-pending | consent-denied |
   shutdown | already-active }; handle.end() returns SessionEndResult —
   ended{ eventId } | not-active (second end).
4. **Invalid input throws**: track() THROWS specific validation errors for
   empty/non-string names and non-JSON-serializable properties. CaptureResult
   is queued | dropped only (reasons: consent-pending, consent-denied,
   queue-full, shutdown). The `failed` and `invalid` variants were removed —
   delivery failures surface via diagnostics + rejected flush/shutdown.
5. **Persistent identity**: AnonymousPersistence = none | session |
   persistent; `persistent` requires runtime.storage or the factory rejects.
6. **Queue units**: maxQueueEvents, maxQueueBytes, maxBatchEvents,
   maxBatchBytes, requestTimeoutMs (plus flushIntervalMs, maxRetries).
7. **Diagnostics**: successful empty flushes are quiet; delivery failure
   emits a `delivery_failed` diagnostic and rejects the awaited flush.
8. **Inventory additions**: root README.md (SDK example + workspace table),
   packages/prism-react (PrismProvider/prism-context/use-prism bind the v1
   client), and the analytics test suites (IpEnrichment.test.ts drives
   AnalyticsController.startSession directly) — all added to the caller
   inventory below.
9. **ADR tracked**: the complete ADR 0002 text is embedded in this task
   file (tracked); engineering/adr/0002-*.md is a local mirror only.
# ADR 0002: Analytics SDK & ingestion v2 architecture

Status: accepted (task-9 slice 1)

Date: 2026-08-12

### Slice 3 + 4 — review correction round (2026-08-12, committed as
### 16e14e0 / 3bec92f / d620d1a / c73ee04 / 5f22a3d)

Review findings (tasks/task-9-slice-4-review.md) — all 14 closed + the
mandatory end-to-end certification:

1. **Transport authentication (F1)**: `PrismRequest` carries `headers`;
   the core supplies `authorization: Bearer <projectKey>` +
   `content-type: application/json`; adapters forward unchanged and never
   log them; the key never appears in diagnostics/errors; the Node
   example forwards `request.headers` to fetch. 401 tests for
   missing/malformed/wrong keys through the real route.
2. **Persistent identity (F2)**: scope-neutral `anonymousId`; stored ID
   validated (shape/size) and reused; fresh ID persisted on miss; storage
   failure keeps ONE stable in-memory ID with a coarse diagnostic;
   withdrawal clears stored + in-memory; re-grant creates a fresh ID
   (never restores the pre-withdrawal identity).
3. **Wire ceilings (F3)**: `INGEST_LIMITS` are hard protocol ceilings —
   the factory rejects `maxBatchEvents`/`maxBatchBytes`/`maxEventBytes`
   above them; shared `isValidEventName` (control chars) and an
   ITERATIVE strict-JSON validator (non-finite numbers, dates, class
   instances, accessors, cycles, dangerous keys, depth/string/key/
   element ceilings) are used by BOTH core and server; shared
   table-driven corpus + parity suite: every core-accepted event is
   server-accepted.
4. **Context policy (F4)**: typed `WireContext`; context gets the same
   strict JSON, dangerous-key, ceiling, and credential-redaction rules as
   properties; 12 000-deep context yields a controlled rejection, never a
   RangeError.
5. **Bounded body reads (F5)**: byte-counted streaming reader cancels at
   the ceiling (Node + Worker-compatible); the Content-Length precheck is
   a cheap early rejection, never the enforcement; falsely small lengths
   cannot bypass; multibyte counted in bytes.
6. **Atomic persistence (F6)**: `IngestRepository` persists all validated
   events in ONE Turso write batch — all commit or none; DB failure → 503
   with no SQL/URLs/content; results stay in submitted order; validation
   rejects never enter the transaction.
7. **Self-hosted routing (F7)**: exact `location = /api/v2/ingest` in the
   bundled nginx BEFORE the general `/api/` rule; the public origin is
   the single SDK endpoint; certified end-to-end through Compose.
8. **Threshold flushing (F8)**: enqueue reaching `maxBatchEvents`/
   `maxBatchBytes` requests a flush, coalesced through the single
   in-flight promise; never while pending/denied or after shutdown;
   persistence ordering stays deterministic via the write chain.
9. **Retry-After minimum (F9)**: a valid server delay is honored verbatim
   (delta-seconds AND HTTP-date), never capped or jittered below;
   client-computed backoff keeps its deterministic jitter; delays beyond
   the timer maximum reschedule in chunks; invalid/past headers fall back
   to exponential backoff with a coarse diagnostic.
10. **Persisted-queue validation (F10)**: exact v2 snapshot schema
    (`{ v: 2, events: [{ eventId, name, occurredAt, serialized }] }`);
    every entry validated with the shared v2 rules + field agreement;
    any doubt quarantines the ENTIRE snapshot; the v1/pre-envelope
    fallback is removed (no production users).
11. **Weighted quota (F11)**: weights validated as positive integers;
    a first overweight request is rejected; rejected hits consume no
    quota; entries are replaced immutably.
12. **Trusted proxy identity (F12)**: forwarding headers trusted only with
    `ANALYTICS_TRUSTED_PROXY=1`; the bundled nginx OVERWRITES
    X-Forwarded-For with the real peer address; direct Node deployments
    use the socket peer; forged headers cannot rotate the per-IP key; IPs
    never appear in stored rows or logs.
13. **Batch-level SDK identity (F13)**: `context.library` removed; SDK
    identity lives ONLY in the batch envelope; the server derives the
    stored SDK metadata from the authoritative batch `sdk` — user context
    cannot override it.
14. **Hermetic consumer test (F14)**: the clean-install test owns a
    temporary npm cache passed to every spawned npm command; no dependence
    on the global npm state.
15. **Mandatory e2e certification** (`scripts/certify-v2-ingest.mjs`,
    21/21 PASS): disposable Compose stack (product API + analytics API +
    sqld + nginx), safety guards (disposable project/volumes, loopback
    ports, refusal on hosted Neon/Turso envs); a REAL @prism/core client
    posts through the public nginx origin; routing verified (v2 ingest
    reaches analytics, never the product API); bearer key derives the
    project server-side; the event is stored once with event ID,
    occurredAt, anonymous ID, sanitized properties/context, and
    batch-derived SDK metadata; replay → `duplicate` with no second row;
    consent withdrawal blocks delivery; an oversized streamed request
    returns 413 at the ceiling; invalid keys get the analytics 401
    through nginx.

Suite state: core 105 tests green (coverage 94.4% lines / 88.7% functions
/ 98.5% branches); analytics 80 passed + 3 opt-in integration (coverage
76.9% lines / 81.1% branches / 82.1% functions). Root gates: test 4/4,
typecheck 7/7, lint 10/10, build 8/8. The mandatory public-origin
certification passes 23/23 (docker-based, CI-run).

### Slice 3 + 4 — hardening round (2026-08-12)

Second review pass (hold-before-Slice-5) — all findings closed:

- **F15 (critical)**: an abort-ignoring transport completing after consent
  withdrawal could requeue reconciled events and start a second request
  while denied. Fixed with a post-await consent + operation-generation
  recheck in doFlush() BEFORE any queue mutation; regression test with an
  abort-ignoring transport and a partial result (exactly one request).
- **F16**: runtime context is allowlisted (typed WireContext fields only),
  strictly validated, credential-redacted, and frozen ONCE at
  initialization — unknown/invalid adapter fields never cross the network,
  and delivery-time JSON crashes (e.g. BigInt) are impossible.
- **F17**: transport errors are replaced with coarse SDK-owned errors
  ("batch delivery failed"/"batch delivery cancelled") — arbitrary adapter
  error text (which may embed the authorization header) never crosses the
  public API through rejections or diagnostics.
- **F18**: setCollectionState validates the transition target; an invalid
  state throws and changes nothing (collection can never be enabled by
  bogus input).
- **F19**: track() and session events share ONE validation + sanitization
  helper; session properties are validated BEFORE the handle is created so
  a rejected tree cannot leave a ghost active session.
- **F20**: every queue option must be a finite positive integer (zero,
  negative, fractional, NaN, infinite rejected with a specific error).
- **F21**: retry cancellation retains and invokes the ACTIVE runtime
  scheduler cancellation handle (including chunked long delays) — pending
  retries no longer keep Node processes/mobile runtimes alive.
- **F22**: explicit proxy modes — ANALYTICS_TRUSTED_PROXY = none (peer
  only) | nginx (X-Forwarded-For only) | cloudflare (CF-Connecting-IP
  only); the bundled nginx CLEARS CF-Connecting-IP on ingestion locations
  so a forged Cloudflare header cannot rotate the per-IP key.
- **F23**: the analytics auth middleware requires an exact
  `^Bearer\s+(\S+)$` match — "Basic Bearer <key>", prefixed, suffixed,
  and empty keys all return 401.
- **F24**: nginx proxies /health/live and /health/ready to the product API
  — the SPA fallback can no longer fake readiness.

Certification accuracy: the script's checks are recounted honestly
(23/23); readiness uses the real proxied health routes + /api/v1/config;
the consent check exercises the IN-FLIGHT race (withdrawal mid-request,
abort-ignoring transport → exactly one request, nothing after); the
stored occurredAt is compared against the client value; the stored
project_id is compared against the seeded project; server-side context
redaction is exercised through a direct HTTP client with credentials in
context.

Suite state: core 119 tests green (coverage 95.2% lines / 90.4%
functions / 98.5% branches); analytics 80 passed + 3 opt-in integration
(coverage 76.8% lines / 80.9% branches / 82.1% functions). Root gates:
test 4/4, typecheck 7/7, lint 10/10, build 8/8. Certification: 23/23.

### Slice 5 — storage (completed 2026-08-12)

- **Ordered migrations + journal**: `db/migrations/NNN_name.sql` +
  `schema_migrations` journal replace the idempotent schema.sql setup
  script. The runner (`src/database/migrations.ts`) applies each migration
  atomically (all statements + the journal row in ONE write batch — a
  failing migration rolls back completely), works identically for hosted
  Turso/libSQL and packaged sqld, and is idempotent (applied versions
  never re-run). `db:migrate` CLI replaces `db:setup`; the container CMD
  runs it at boot.
- **Migration set**: 001 creates the final v2 `events` table (project,
  id, type, name, schema_version, occurred_at, received_at, session_id,
  anonymous_id, properties, context, sdk_name, sdk_version; PRIMARY KEY
  (project_id, id)) + the justified query indexes; 002 creates
  `sessions_v2` (client-generated IDs, start/end/last-seen, context,
  online flag) + a legacy-compatible `sessions` table WITHOUT raw IP
  columns; 003 drops the interim events_v2 table. A legacy v1 `events`
  table makes migration 001 FAIL LOUDLY (no silent wrong-shape serve);
  the guarded reset is the escape hatch for disposable stores.
- **SDK metadata columns (review F13)**: the ingestion repository stores
  batch-derived sdk_name/sdk_version in explicit columns; context JSON no
  longer carries an injected sdk — user context cannot override it.
- **Raw IP removal**: the v1 sessions table and the v1 ingestion
  controller no longer carry/write ip/lat/long; geo enrichment still
  informs country_code. The remaining raw-IP removal (WebSocket messages,
  read queries, docs) completes with the v1 route removal in slice 6.
- **Retention rework**: operates on v2 timestamps (events by received_at,
  sessions_v2 by last_seen_at — INTEGER ms) plus the legacy sessions
  table by created_at (existence-guarded); one atomic write batch,
  dependents first; --status/--dry-run/apply, idempotency, and redacted
  output preserved; retentionCutoffMs added.
- **Guarded reset**: `db:reset` prints the resolved non-secret target
  identity, refuses anything but file:/loopback targets, requires BOTH
  ANALYTICS_RESET_ALLOW=1 and --yes, drops every analytics table + the
  journal in one atomic batch.
- **JSON strategy decision**: properties/context stored as verbatim JSON
  TEXT; extracted/generated columns deferred until measured read-query
  needs (slice 6); the four justified indexes verified with EXPLAIN
  QUERY PLAN on representative data (USING INDEX confirmed).
- **Tests (always-run, real libsql :memory:)**: migrations.test.ts (10 —
  journal, idempotency, pending-only, atomic rollback, legacy-conflict
  loud failure, EXPLAIN plan verification, reset approval policy +
  atomic drop + re-migrate); retention.test.ts updated (9 — v2 + legacy
  timestamps, dry-run, atomic apply, idempotency); IpEnrichment tests
  assert ip/lat/long are never persisted.
- **Real-store verification**: against a packaged sqld container —
  db:migrate applies 3 migrations + re-run is a no-op; guarded reset
  refuses without ANALYTICS_RESET_ALLOW/--yes and succeeds with them;
  the opt-in integration suite runs 3/3 against the migrate-created
  schema (v1 session flow + v2 ingest, replay duplicate, cross-project
  scoping, SDK columns); the public-origin certification re-ran 23/23
  against the new schema. (The restart-persistence drill could not be
  re-run on this machine — the Docker VM disk is full; its v1 flow is
  covered by the real-store integration run above and remains a CI
  check.)

Suite state: core 119 tests green; analytics 102 passed (92 unit +
10 always-run migration/reset) + 3 opt-in integration (executed for real
against sqld during this slice). Root gates: test 4/4, typecheck 7/7,
lint 10/10, build 8/8.

### Slice 6 — read/realtime (completed 2026-08-13)

- **v1 removal (ADR 0002 §2)**: the v1 analytics routes
  (`POST /api/v1/analytics/sessions|sessions/end|events`), the v1
  AnalyticsController, CreateNewSessionResponse, IpEnrichmentService, and
  the browser/OS/mobile-detection utils are gone; the analytics app serves
  only `/api/v2/ingest` + the authorized WebSocket. The v1 request schemas,
  `SocketUserConnected`, `CreateNewSessionResource`, and `IpInfoResponse`
  left @prism/types; the legacy `PrismClientV1` (core `prism-client.ts`/
  `types.ts`) and @prism/react's v1 bindings were removed (the react
  package is an empty shell until slice 8). Migration 004 drops the legacy
  `sessions` table; retention no longer has a legacy path.
- **Sessions v2 + realtime**: the ingestion repository maintains
  `sessions_v2` in the SAME atomic write batch as the events
  (session_started upserts, session_ended closes, sessioned events bump
  last_seen_at); accepted session_started events broadcast a
  project-scoped, JWT-authorized `session-started` WebSocket message (the
  dashboard's realtime page + store + WebSocketManager moved to it).
- **Product API reads (bounded, honest)**: `analyticsStore.ts` computes
  per-day session counts + device splits with parameterized, date-bounded
  SQL aggregates (`session_started` events, context.kind) — no session-row
  loads into memory; `getProjectEvents` decodes properties JSON at the
  boundary into typed camelCase resources; browser/OS/country rankings
  have no v2 source and were REMOVED (fabricated rankings + their chart
  components deleted); the dashboard's "Visitors" label is now "Sessions"
  (cross-session visitor uniqueness does not exist yet); the realtime page
  renders v2 session rows (no raw IP/coordinates — the map stays
  decorative, Mapbox-optional); the overview/landing/onboarding
  copy + code snippets use `track()`/`createPrismClient`.
- **Web telemetry v2**: main.tsx drops the hardcoded v1 client +
  PrismProvider; `lib/prism.ts` builds a v2 client with a small inline
  browser runtime, gated by `VITE_TELEMETRY_KEY` (opt-in, endpoint =
  serving origin, never compiled in).
- **Docs**: sdks/javascript|events|sessions|react, quickstart, concepts,
  api-reference/ingestion, operations/networking|security,
  reverse-proxy — all v1 wire/SDK references replaced with the v2
  contract (the deeper Fumadocs pass remains slice 9).
- **Certification + drills**: the restart drill seeds through
  `/api/v2/ingest`; the public-origin certification re-ran 23/23 against
  the slice-6 stack (product API seeding through the new bounded read
  paths, v2 ingest, session state, realtime-safe path).
- **Fixed latent breakage**: web vitest `test.alias` (the pre-existing
  `resolve.alias` was dead under vite 7 — masked by turbo cache), web
  tsconfig deprecations, docs frontmatter YAML quoting.

Suite state: core 119 tests (95.2/90.4/98.5/95.2); analytics 82 passed +
2 opt-in integration; api 110 passed + 4 opt-in; web 23 passed. Root
gates: test 4/4, typecheck 7/7, lint 10/10, build 8/8. Certification:
23/23.

### Slice 7 — browser (completed 2026-08-13)

- **`@prism/browser`** (new workspace package): `createBrowserClient({…})`
  is a THIN runtime seam over @prism/core — the core owns every queueing,
  consent, sanitization, session, authentication, and retry semantic; the
  package only translates browser primitives. Explicit runtime `endpoint`
  required (no compiled-in host, no API_URL substitution anywhere); fails
  loudly outside a browser (Node import stays window-free at module
  scope).
- **Transport**: authenticated `fetch` with `keepalive: true` — unload
  flushes carry the write key; there is never an unauthenticated
  `sendBeacon` fallback implying success (asserted by test).
- **Storage**: localStorage-backed adapter with a write/read probe —
  storage denial (privacy modes, quota) degrades to the core's in-memory
  queue, never a crash; reload persistence flows through the core's
  versioned queue snapshot; two-tab tradeoff recorded (project-scoped
  key, server dedup).
- **Context**: the APPROVED minimal set only — platform/kind, viewport,
  locale, timezone. No user-agent capture (the server sees the request UA
  naturally; no v2 report needs a second copy — the decision is
  recorded). `capturePageContext()` exports the sanitized path (pathname
  only — query strings/hashes excluded) and referrer ORIGIN (never a full
  URL) for explicit tracking.
- **Lifecycle**: visibilitychange → foreground/background,
  beforeunload → before-unload with the core's bounded flush; the core's
  per-subscription removers give deterministic cleanup (asserted:
  post-shutdown unload events are no-ops).
- **Tests (20, jsdom)**: runtime endpoint + core-owned auth headers +
  keepalive; endpoint required; approved-context capture; sanitized
  path/referrer; storage denial fallback; lifecycle flush; deterministic
  cleanup; offline retention + recovery; denied consent; reload
  persistence via localStorage; two tabs; Node-without-DOM import +
  loud failure; branch coverage 82.9%.
- **Package-consumer smoke**: real pack+install fixture (owned npm
  cache) installing @prism/browser AND its unpublished @prism/core
  dependency from workspace tarballs, consumed via public exports against
  an explicit self-hosted endpoint.
- **Web product**: the interim inline runtime in lib/prism.ts is replaced
  by @prism/browser (first production consumer); the web Dockerfile
  builds and ships the package.
- **Analytics readiness (§8)**: /health/live (process) + /health/ready
  (store ping — the migrated schema must exist; enrichment is never a
  readiness dependency) + container HEALTHCHECK.

Suite state: browser 20 tests (98.3/82.9/100); core 119; analytics 82+2
opt-in; api 110+4 opt-in; web 23. Root gates: test 5/5, typecheck 8/8,
lint 11/11, build 9/9.

### Slice 8 — React (completed 2026-08-13)

- **`@prism/react` rebuilt as a thin binding** (§12): `PrismProvider`
  accepts an ALREADY-CREATED, READY client (never an initialization
  config — non-React ownership and cleanup stay explicit); the provider
  registers NO effects, listeners, or timers (Strict Mode double-mounting
  cannot duplicate work); it is NOT an error boundary and performs no
  console-only error handling; no automatic route tracking.
- **`usePrism()`** returns a STABLE facade (`track`, `startSession`,
  `setCollectionState`, `flush`, `shutdown`, `onDiagnostic`,
  `collectionState`, raw `client`) — bound references keep their identity
  across renders; a specific error outside a provider. `logCustomEvent`
  is gone — the industry-familiar `track` only.
- **Tests (10, jsdom)**: ready-client publishing, missing-provider error,
  stable references across re-renders, Strict Mode no-duplication, no
  client replacement, no updates after unmount, context passthrough,
  bound-facade calls, full facade surface — 100% coverage.
- **React 18 peer evidence**: a pack+install fixture installs react@18 +
  react-dom@18 from the registry (isolated cache) and renders the
  provider through the React 18 entry — real cross-major proof beyond the
  `^18 || ^19` peer range.
- **Adapter authoring guidance** recorded (docs page + below).

### Slice 9 — Docs/QA + security close-out (completed 2026-08-13)

- **§15 storage namespaces**: the persisted queue key now carries BOTH
  endpoint identity (djb2-hashed origin) and project identity —
  `prism:queue:v2:<endpoint-hash>:<projectKey>` — so an endpoint change
  (hosted → self-hosted, instance migration) can never silently deliver a
  persisted queue to a different instance. Tested: endpoint-A's offline
  queue never crosses to endpoint-B's client. The anonymous ID stays
  deliberately ORIGIN-scoped (one anonymous identity per origin, the
  shared-segment pattern) — recorded as the decision.
- **Docs**: concepts page gains the three-layer core/browser/react
  architecture table; new `sdks/consent.mdx` (the pending/granted/denied
  state machine + effective withdrawal) and `sdks/adapters.mdx`
  (framework-author guidance); `sdks/react.mdx` rewritten around the
  thin provider; javascript.mdx gains the honest delivery-semantics
  section (queued ≠ delivered, flush can reject, shutdown bounded);
  privacy.mdx corrected (no build-time origin baking, no rebuild
  instruction, raw IPs never persisted); api-reference/core.mdx lists the
  full public surface, drift-checked by `scripts/docs-api-drift.mjs`
  (44 exported names, fails on any drift).
- **Analytics readiness (§8)**: /health/live + /health/ready (store
  ping) + container HEALTHCHECK.
- **Gates**: every checklist in §12–§15 is closed. Full run: test 6/6,
  typecheck 9/9, lint 11/11, build 9/9, audit clean, docs build green,
  certification 23/23 (rerun against the slice-6/7 stack).

Suite state: core 120 tests (95.2/90.4/98.5/95.2); browser 22
(98.3/82.9/100); react 10 (100/100/100); analytics 82+2 opt-in; api
110+4 opt-in; web 23. Root gates: test 6/6, typecheck 9/9, lint 11/11,
build 9/9, audit clean.

### Slice 9 close-out — remaining decisions recorded (2026-08-13)

- **§4 consent items**: the low-level core has NO default consent state at
  all — `collection.initialState` is REQUIRED, which is stricter than the
  "default pending" option (a caller must always be explicit). The
  browser factory now defaults to **session-scoped anonymous persistence**
  (§4 item) unless the caller asks otherwise — tested (session default +
  explicit `none`). Pending/denied never serialize or retain properties
  (validation runs but nothing is stored); withdrawal clears queue +
  identity + session; re-grant starts a fresh context; sanitizer +
  `[REDACTED]` decision, no URL-query/fragment/form capture, transient
  IP-only usage, no persisted coordinates, optional non-blocking
  enrichment, and the consent/privacy docs are all in place.
- **§7 session semantics**: sessions are FIRST-CLASS ingestion records
  (session_started/session_ended events) with sessions_v2 as the derived
  aggregated state — the decision is recorded. Start/end semantics live
  in the core; activity = any sessioned event (last_seen bump); inactivity
  and staleness are server-side via last_seen; SESSION ROTATION is
  explicitly NOT implemented (deferred to a later task — the v2 model
  rotates only through explicit end/start). Offline start/end transitions
  queue like any event (tested); clock-skew validation bounds future
  timestamps; realtime emits project-scoped session-started messages;
  session updates are scoped by authenticated project + session ID.
  Adapter-managed (browser) and sessionless (Node/server) workflows are
  the documented patterns — no process is forced into a browser-like
  session.
- **§16 completion criteria**: all checked — the ADR/contract are tracked,
  the core is platform-global-free, capture is explicit with observable
  outcomes, events queue before any network response, runtime endpoint
  configuration works hosted + self-hosted, ingestion validates/sanitizes/
  scopes/rate-limits/persists idempotently, the schema is
  migration-owned/resettable, v2 journeys (sessions/events/realtime/
  onboarding) work end to end, the adapters contain no copied queue
  semantics, no autocapture/identity/observability features were smuggled
  in, coverage gates hold, the working tree is clean and the
  implementation is committed in reviewable slices.

Final state: ALL task-9 checklist items are closed (189/189). Suite:
core 120, browser 22, react 10, analytics 82+2 opt-in, api 110+4 opt-in,
web 23. Root gates: test 6/6, typecheck 9/9, lint 11/11, build 9/9,
audit clean, docs build + drift green. Certification 23/23.

### Release review round 3 — four High + five Medium closed (2026-08-13)

- **High — duplicate session events mutated session state**: the
  repository now applies sessions_v2 mutations ONLY for newly inserted
  events (two write batches: atomic event inserts, then derived state
  for accepted events; a session-batch failure is logged and the honest
  `accepted` response stands — the derived state is recoverable).
  Duplicate session_started/session_ended/ordinary replays change
  NOTHING (unit + real-sqld integration: a replayed start never reopens
  an ended session).
- **High — browser timeouts**: the browser transport bridges the core
  signal to a real AbortController AND schedules an abort from
  `request.timeoutMs`; a timeout abort is a genuine delivery failure for
  the retry policy. Tested with fake timers (hanging fetch aborts at the
  configured timeout).
- **High — multi-tab persistence loss**: the persisted snapshot is now
  OWNER-SEGMENTED (v3, one segment per execution context) with an
  adoption + tombstone merge: persisting replaces THIS context's segment
  while preserving others', restored events are adopted and tombstone
  the stale copies, delivered/consent-purged IDs never resurrect. The
  browser additionally routes queue snapshots to SESSION storage
  (per-tab namespace; identity stays origin-shared in localStorage).
  Tests: sequential shared-storage merge keeps both tabs' events; a
  delivered event never replays; racing microtask interleaving is a
  documented best-effort window (real tabs never share the namespace).
- **High — self-hosted owners could not subscribe to realtime**: the
  WebSocket auth verifies the ACTIVE user role-agnostically and
  authorizes through project/team membership (SQL asserted to carry no
  role filter; an ADMIN owner subscribes successfully).
- **Medium**: keepalive only within the ~64 KiB browser budget (batch-
  level test); the React facade's collectionState is a live getter;
  /health/ready verifies the migration journal's latest version AND
  sessions_v2; event-size validation measures the RAW payload (unknown
  fields cannot smuggle an oversized event); the sessions store is
  project-scoped + deduped + cleared (never persisted — live-only);
  realtime renders session rows without Mapbox; the production /test
  route is gone (404 test).
- **Verification**: core 122, browser 25, react 11, analytics 88+2
  opt-in, web 24, api 110+4 opt-in; real-sqld integration 3/3 with the
  duplicate-replay flow; root gates: test 6/6, typecheck 9/9, lint
  11/11, build 9/9, audit clean, docs drift OK. The React 18 fixture's
  registry-dependent test timeout raised to 300 s.


## Context

The current SDK (`@prism/core`) is browser-coupled, best-effort, and bakes a
hosted ingestion URL into the build (`API_URL` env in the package build
script). Sessions are server-owned, events carry no client-generated ID, and
there is no consent/collection state, queue, batching, or deterministic
shutdown. The analytics schema (sessions/events in Turso/libSQL) stores raw IPs
and is applied by an idempotent setup script rather than owned by migrations.

Prism's product roadmap (analytics → web analytics → observability) and future
runtimes (React Native, Node/Hono, Vue, Svelte) require one runtime-neutral
foundation instead of per-framework SDK reimplementations.

## Decisions

### 1. Core/runtime boundary

- `@prism/core` is the runtime-neutral engine. It must import and run without
  DOM, React, React Native, Node-specific, Cloudflare-specific, or
  provider-specific globals, and have zero import-time side effects.
- Runtime capabilities (transport, storage, time, ID generation, lifecycle
  hooks) arrive through an injected **runtime adapter**. No framework package
  owns queueing, identity generation, consent, sanitization, session
  semantics, retries, or wire-format construction.
- Adapters: `@prism/browser` (thin), `@prism/react` (thin provider/hook),
  future `@prism/react-native`, `@prism/node` — all over the same core.

### 2. Versioning strategy

- Package versions follow semver. The wire protocol is versioned separately:
  the v2 endpoint is `POST /api/v2/ingest` (batch). The old single-event v1
  endpoints are removed rather than maintained — there are no production
  users, and the repository must not mix v1 and v2 SDK calls or examples.
- One envelope version per endpoint major; the SDK sends exactly the envelope
  its major supports.

### 3. Event ID and session ownership

- **Event IDs are client-generated** at `track()` time, before enqueueing, via
  the runtime's ID seam (crypto-random UUID where available; injectable
  otherwise). The server never assigns event IDs.
- **Sessions are client-owned lifecycle objects**: explicit
  start/transition/end commands on the client, with locally generated session
  IDs. The server stores session_id + occurrence timestamps and derives
  aggregates; v2 ingestion does not mutate a server-side "current session".
  The shape supports browsers, app foreground/background transitions, and
  sessionless server events without nullable-field clusters.

### 4. Queue, batching, and delivery lifecycle

- Accepted events enter an immutable FIFO queue immediately. Events generated
  before any network handshake are queued, never discarded.
- Delivery: batching (size + time windows), safe retries with bounded backoff,
  explicit `flush()` and `shutdown({ timeoutMs })` (idempotent; stops timers/
  listeners; bounded final flush; post-shutdown capture is explicit).
- Background delivery failures never crash the host; they surface through the
  diagnostics subscription and through rejected flush/shutdown promises.

### 5. Privacy and collection state

- Collection is an explicit state machine: `pending` → `granted` | `denied`.
  In `pending`/`denied`, `track()` returns a `dropped` result with a reason —
  no hidden pre-consent behavioral queue is built.
- Anonymous identity persistence policy is explicit (`session` | `none`).
- **Raw IP addresses are never persisted** in the analytics database. Geo
  enrichment may derive country-level data server-side from the connection IP
  without storing the raw value.
- No console output from the SDK itself; capture results are the inspection
  surface.

### 6. Self-hosted endpoint behavior

- `endpoint` is a required runtime option for every adapter. The SDK build
  never bakes a hosted URL (the `API_URL` build-time variable is removed).
  Hosted quickstarts pass the hosted endpoint; self-hosted installs pass their
  own origin.

### 7. Public contract and types ownership

- Public analytics TypeScript types are exported by `@prism/core`; consumers
  never need `@prism/types`.
- `@prism/types` stays private and internal (shared wire schemas between
  services). Internal packages (`brand`, `config-typescript`,
  `email-templates`, `jest-presets`, `types`) are `private: true` — already
  the case; verified in slice 1.
- The public root stays small: client/factory, narrowly useful contracts, JSON
  value types, capture results, diagnostics, adapter interfaces. No queue
  nodes, database fields, retry timers, or HTTP internals.
- Event variants and state machines are discriminated unions with `readonly`
  observed state; state changes are explicit commands. Invalid events,
  missing required adapters, or malformed endpoints throw specific errors
  during local validation — never silent no-ops.

### 8. Package names and npm scope

- Keep `@prism/core`, `@prism/browser`, `@prism/react` names in the source
  tree until npm scope recovery is resolved. No publish, placeholder
  reservation, or rename during this task. The scope decision lives in one
  documented release checklist.

### 9. Database migration approach

- The analytics store becomes migration-owned: forward-only migrations in the
  analytics workspace replace the bare setup-script schema. The v2 model has
  no raw IP field/data; retention (ANALYTICS_RETENTION_DAYS) applies to the v2
  model.
- A destructive analytics reset is permitted only after the execution agent
  resolves and verifies the exact development/test database target — never an
  unresolved URL, a production-looking target, or a broad deletion command.
  Product/authentication data in PostgreSQL is outside the reset.

### 10. Runtime matrix

- Capability-based, not user-agent guessing: standards-based JS core (plain
  Node), modern browser adapter, and fake adapters representing Node and
  native/mobile hosts.

## Consequences

- Breaking SDK contract change, coordinated with the ingestion rewrite; all
  callers from the slice-1 inventory are migrated in the same release.
- The docs quickstarts switch to runtime endpoints; old examples removed.
- Read paths (management queries, realtime, dashboard) keep working against
  the v2 model with honest labels/counts.


### Slice 2 status (core state, completed 2026-08-12)

The v2 core is implemented behind the frozen contract and the contract
suite is GREEN:

- `packages/core/src/core.ts` (createPrismClient + PrismClientImpl),
  `queue.ts` (immutable FIFO with event/byte accounting), `validation.ts`
  (event name, JSON-serializability, config), `index.ts` barrel.
- Consent state machine (pending/granted/denied; pending/denied never
  queue; denied-clear and re-grant semantics for the v1-era queue are
  covered by the privacy items left open for the delivery slice),
  client-owned sessions (started/blocked results, end once),
  track() with queued/dropped results and throwing validation,
  diagnostics with idempotent handles, flush with one in-flight guard,
  retries with Retry-After reading + bounded attempts + batch drop,
  idempotent shutdown with bounded final flush, anonymous identity
  persistence (session/persistent via storage).
- The baked hosted URL is fully removed (build scripts + tsup env
  define); the v1 legacy default is a same-origin relative path.
- Contract + core suites: 39 tests green. Coverage on the v2 core:
  95.5% lines / 88.2% functions / 86.5% branches / 95.5% statements —
  above the 80% gate. Root gates: test 4/4, typecheck 7/7, lint 10/10,
  build 8/8.

Open for later slices (noted in their sections): queue persistence
through storage with versioned keys, server accepted/duplicate/rejected
handling, permanent-4xx classification, drop-oldest overflow policy,
package-consumer clean-fixture test, bundle-size budget, and the v1
legacy removal.

### Slice 2 review corrections (applied 2026-08-12)

1. **Consent withdrawal is effective**: `setCollectionState("denied")` clears
   the queue, deletes the persistent anonymous ID through storage, and
   closes the active session — nothing queued before the withdrawal can be
   transmitted afterwards; re-grant starts a fresh anonymous context.
2. **Session handles are scoped**: an old handle cannot end a newer session
   (end() only resolves when the handle IS the active session; otherwise
   `not-active`).
3. **Delivery lifecycle**: the background flush loop self-reschedules after
   every tick through the runtime scheduler; shutdown aborts only the
   in-flight background request and runs the bounded final flush with a
   FRESH signal; the shutdown timeout uses the runtime scheduler (no global
   setTimeout in core); lifecycle subscriptions are removed on shutdown;
   concurrent flush() calls share the in-flight promise (one transport
   request).
4. **Ready factory**: createPrismClient awaits identity/queue state
   initialization — it resolves only when the client is fully ready (the
   test's waitFor was removed).
5. **Public type**: the package root exports the v2 `PrismClient` interface;
   the legacy class is re-exported as `PrismClientV1` (deprecated) and the
   web/prism-react callers were updated; the built declarations verify
   `import type { PrismClient } from "@prism/core"` resolves to the v2
   contract.
6. **Property sanitizer** (contract option `sanitize`): credential keys
   (password/passcode/token/authorization/cookie/secret/api key/
   credit-card/security-code variants + custom deny-list) are replaced with
   the stable `[REDACTED]` marker at any depth and in arrays; depth (12) and
   string (10 000) limits throw specific validation errors; event names are
   capped at 128 characters.
7. **Queue edge case**: the head event always joins its batch — an event
   larger than maxBatchBytes delivers as a solo batch instead of wedging the
   queue; byte accounting uses encoded UTF-8 length, not UTF-16 string
   length.

Suite after corrections: 52 tests green; coverage 92.7% lines / 88.8%
functions / 91.1% branches / 92.7% statements. Root gates: test 4/4,
typecheck 7/7, lint 10/10, build 8/8.

### Slice 2 second review round (applied 2026-08-12)

1. **Consent withdrawal cancels in-flight delivery**: `setCollectionState
   ("denied")` now aborts `inFlightSignal` too — a pending transport request
   is cancelled, emits `delivery_cancelled`, and transmits nothing after
   the withdrawal (consent-race test: hanging transport honoring the
   signal; post-withdrawal flush makes zero calls).
2. **Shutdown is bounded end-to-end**: one `withTimeout` deadline wraps the
   whole drain (in-flight settle + final flush); a transport that ignores
   cancellation cannot hang shutdown (hanging-transport test resolves
   within the deadline; the test fake runtime honors `delayMs`).
3. **Cancellation is not retry exhaustion**: an aborted signal skips
   `recordFailure` — no attempt count, no `batch_dropped`; the batch is
   preserved and the promised fresh final flush delivers it (maxRetries 1
   test: cancelled attempt + second successful attempt, no batch_dropped).
4. **Strict JSON + dangerous keys**: the sanitizer rejects
   prototype-pollution keys (`__proto__`, `constructor`, `prototype`) and
   runtime-only values (undefined, functions, symbols, bigints) with
   specific errors; the JSON error message is unified.

Suite: 57 tests green; coverage 95.3% lines / 89.9% functions / 95.7%
branches / 95.3% statements. Root gates: test 4/4, typecheck 7/7,
lint 10/10, build 8/8.

### Slice 3 — delivery (completed 2026-08-12)

- **Queue persistence**: queued events are snapshotted through the storage
  adapter under a namespaced, versioned key (`prism:queue:v1:<projectKey>`)
  on every mutation, with writes serialized on a chain so the final state
  is deterministic; the factory restores the queue before resolving.
  Corrupt or future-version state is quarantined (cleared + removed) with
  a `queue_state_reset` diagnostic. Tradeoff recorded per task §6: two
  contexts sharing a project key overwrite each other's snapshot —
  server-side dedup by eventId covers overlap; the browser adapter
  implements a storage lease in its slice.
- **Permanent 4xx handling**: 400/401/403/413 drop the batch immediately
  with a `batch_rejected` remediation diagnostic (no key/body exposure);
  408/429/5xx and network failures stay on the retry path with
  Retry-After + bounded attempts.
- **Per-event results**: tolerant parsing of `{ results: [{ id, status }] }`
  from the v2 ingest response — accepted/duplicate/rejected all leave the
  queue, rejected events are never resent, and a plain 2xx body accepts
  the whole batch (status-only success).
- **Package-consumer + budget tests**: the built artifact (dist) is
  consumed in a clean fixture test (createPrismClient + PrismClientV1
  reachable, smoke client created) and the bundle budget is asserted
  (dist/index.js 27.5 KB < 60 KB baseline).
- **Overflow policy**: the frozen contract's `queue-full` result (drop the
  triggering event with an observable result) is retained over the
  drop-oldest preference in §6 — recorded as the contract decision;
  memory growth stays bounded.

Suite: 68 tests green (3 files incl. dist-consumer); coverage 94.8% lines
/ 90.6% functions / 98% branches / 94.8% statements. Root gates: test
4/4, typecheck 7/7, lint 10/10, build 8/8.

### Slice 3 — correction round (second review, 2026-08-12)

Reviewer findings and fixes:

1. **Double dequeue (critical)**: deliver() removed the batch AND doFlush()
   removed it again — with maxBatchEvents 1, b was lost between a and c.
   Fixed: doFlush() is now the SINGLE owner of queue removal (success,
   reconciliation, permanent rejection, and retry exhaustion all pass
   through it); deliver() returns an outcome and never mutates the queue.
   Regression test: maxBatchEvents 1, a/b/c → exactly 3 posts, all events.
2. **Restore/transmit under denied or pending (critical)**: ready() restored
   persisted events regardless of consent, and flush() did not enforce
   consent. Fixed: doFlush() gates on `state === "granted"` (covers
   explicit, background, retry, and shutdown flushes); restore is
   consent-aware — granted restores once, pending defers the snapshot
   (restored on grant), denied purges it with a `queue_state_purged`
   diagnostic. Tests: denied-created client never transmits a seeded
   snapshot; pending defers until grant, then delivers.
3. **Stale persisted queue after shutdown (high)**: persistQueue() bailed
   when `closed`, so a successful final delivery could not persist the
   empty queue and the next client replayed events. Fixed: no closed bail;
   mutation-time snapshots (serialized write chain) plus an explicit
   close-out snapshot in shutdown. Test: delivered-once event is not
   replayed by the next client.
4. **Non-reconciled per-event results (high)**: results were counted, not
   matched. Fixed: strict reconciliation — only SUBMITTED ids with a
   terminal status (accepted/duplicate/rejected) leave the queue; missing
   results, unknown statuses, unrelated ids, and duplicate/unknown entries
   make the response "malformed" → bounded retry (server-side dedup makes
   resends safe); non-terminal members are requeued at the head in order.
   Tests: unrelated ids keep the batch; duplicate ids → malformed; partial
   reconcile removes only terminal events.
5. **Retry policy (high)**: no automatic retry loop existed. Fixed:
   bounded scheduled retries — exponential backoff from 1 s (×2, ±20%
   deterministic djb2-hash jitter, no platform globals), capped at 60 s;
   numeric Retry-After honored (capped); HTTP-date form falls back to
   exponential backoff; at most one pending retry; maxRetries bounds total
   attempts → `batch_dropped`. Tests with a recorded-scheduler fake:
   auto-retry without external flush (1 s → 2 s → success), Retry-After 2 s
   honored, exhaustion stops the loop.
6. **Corruption test (medium)**: seeded a key the client never reads and
   subscribed after init diagnostics. Fixed: seeds the real
   `prism:queue:v1:<projectKey>` key; new `onDiagnostic` factory option
   subscribes BEFORE ready(), making queue restore/quarantine/purge
   observable through the public API.
7. **Consumer test (medium)**: was a workspace-dist import that skipped
   silently. Fixed: real `npm pack` → clean temp-fixture `npm install`
   → metadata assertions (name/version/files/exports map/main/module/
   types) → require() through the exports map → working client from the
   installed copy. Added `exports` map + `files: ["dist"]` to
   package.json so the tarball carries the build. Bundle budget kept
   (dist/index.js < 60 KB baseline).

Suite: 78 tests green (3 files); coverage 96.1% lines / 90.8% functions
/ 98.2% branches / 96.1% statements. Root gates: test 4/4, typecheck
7/7, lint 10/10, build 8/8.

### Slice 4 — ingestion (completed 2026-08-12)

- **Wire envelope (core)**: events serialize as the v2 envelope
  (schemaVersion 2, eventId, type "track", occurredAt, sessionId?,
  anonymousId?, name, properties?, context with normalized runtime
  context + library identity); delivery posts the batch envelope
  `{ schemaVersion, sentAt, sdk, events }`. The internal QueuedEvent
  mirrors occurredAt as timestamp; restore maps occurredAt with a
  defensive fallback for pre-envelope persisted snapshots.
- **Shared limits** (`packages/core/src/limits.ts`, exported from
  @prism/core): WIRE_SCHEMA_VERSION, SDK_NAME/SDK_VERSION, INGEST_LIMITS
  (50 events/batch, 512 KiB/request, 32 KiB/event, 128 name chars, depth
  12, string 10 000, future skew 5 min, past window 30 days) + wire types
  (WireEnvelope/WireBatch/IngestResult/IngestResponseBody). New
  `maxEventBytes` queue option (32 KiB): larger events drop queue-full so
  the SDK can never produce an event the server rejects as oversized (no
  poison-retry loop). Recorded deviation: the §3 property-key and
  array-element ceilings are deferred until the SDK enforces matching
  caps; the shared constants source prevents drift.
- **POST /api/v2/ingest** (`IngestController` + `IngestRouter`, behind the
  existing write-key auth middleware; project derived from the key,
  client ownership fields ignored): content-type check + content-length
  pre-check before parsing (413 too-large); zod envelope validation
  (400 invalid-envelope); per-event validation with a depth-limited
  walker (invalid-name / invalid-properties / invalid-timestamp /
  unsupported-type / too-large / invalid-event); prototype-pollution keys
  are rejected on the RAW event because zod's record parse cannot carry
  own `__proto__` keys; partial-batch policy: 200 with per-event results
  `{ index, id, status, reason? }`, never echoing properties/values/keys.
- **Server-side sanitization**: direct HTTP clients are untrusted — the
  shared @prism/core sanitizer runs on every accepted event before
  persistence ([REDACTED] marker, same limits as the SDK).
- **Idempotency**: `events_v2` table with PRIMARY KEY (project_id, id) +
  `ON CONFLICT (project_id, id) DO NOTHING` — transport retries become
  "duplicate", never a second row; cross-project event IDs are not
  duplicates (scoping tested).
- **Rate limiting**: RateLimiter.hit(key, weight); the per-IP request
  limiter now covers /api/v2/*; event-weighted per-project quota
  (ANALYTICS_EVENT_RATE_LIMIT, default 10 000/min) so batching cannot
  multiply the allowance by the batch size; 429 + Retry-After (the core
  SDK honors Retry-After in its retry loop).
- **Storage (interim)**: events_v2 + query indexes appended to
  schema.sql; the ordered migration journal, v1 events/sessions removal,
  and retention rework land in the storage slice.
- **Security/logging**: coarse error codes only; ingestion logs counts +
  ids (never properties); responses never echo payloads, keys, write
  keys, SQL, or provider errors.
- **Deploy**: analytics-api now depends on @prism/core; the Dockerfile
  builds and ships packages/core/dist; tsconfig baseUrl/paths removed
  (TS 6 deprecation surfaced by the cache-cold rebuild).
- Tests: 17 IngestController unit tests (envelope, per-event, partial
  batch, idempotency, scoping, sanitization, rate limit, no-echo),
  RateLimiter weight test, opt-in v2 integration flow (accepted →
  duplicate replay → cross-project accepted → sanitized read-back), core
  envelope/cap/restore-fallback tests.

Suite: core 81 tests green (coverage 96%+ lines); analytics-api 74 passed
+ 3 opt-in integration (coverage 75.5% lines / 80.5% branches / 81.3%
functions, gate 60/60/70/60). Root gates: test 4/4, typecheck 7/7,
lint 10/10, build 8/8.
