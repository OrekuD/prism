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

- [ ] Define JSON-safe primitives and objects. Reject functions, symbols,
      bigint values, non-finite numbers, cyclic structures, class instances,
      unsupported dates, and `undefined` at runtime rather than relying only
      on TypeScript.
- [ ] Add a versioned envelope base containing at least: `schemaVersion`,
      `eventId`, event `type`, `occurredAt`, optional `sessionId`, optional
      `anonymousId`, and runtime/library context.
- [ ] Keep the project ID out of the client-controlled body. Derive it from the
      authenticated write key on the server.
- [ ] Give explicit track events their own variant with a non-empty `name` and
      optional JSON-safe `properties`.
- [ ] Reserve stable extension points for future page, screen, identify,
      group, exception, and metric variants without exporting fake capture
      methods during this task.
- [ ] Add batch-level `sentAt` and SDK metadata only where it avoids repeating
      identical values. Do not make query logic depend on an undocumented mix
      of batch-level and event-level fields.
- [ ] Include context that is meaningful across runtimes: SDK name/version,
      runtime kind, optional application name/version/build/environment,
      locale, timezone, and runtime-provided device/page/screen information.
      Browser-only fields must stay in a browser context variant.
- [ ] Generate event IDs and session IDs client-side with a collision-resistant
      adapter. Never wait for a server session response before accepting an
      event into the local queue.
- [ ] Store both `occurredAt` and server-generated `receivedAt`; analytics must
      distinguish offline/delayed delivery from the time the action occurred.
- [ ] Validate timestamps and reject unreasonable future clock skew while
      permitting bounded offline delivery. Document the accepted window and
      how retention treats delayed events.
- [ ] Define centralized, tested limits. Suggested initial ceilings are 50
      events per batch, 512 KiB per request, 32 KiB per serialized event, 128
      characters per event name, five nested property levels, 100 total
      property keys, 100 array elements, and 4 KiB per string. If benchmarks
      justify different values, record them in the ADR and use one shared
      constants source.
- [ ] Reject empty/whitespace-only names and control characters. Do not impose
      a naming regex that prevents reasonable human-readable event names;
      document a recommended naming convention separately.
- [ ] Reject prototype-pollution keys such as `__proto__`, `prototype`, and
      `constructor` at every nested level.
- [ ] Add golden contract fixtures that encode in core, validate at ingestion,
      persist, read back, and compare without undocumented field loss.

## 4. Make privacy and collection state foundational

- [ ] Model collection state as one discriminated state: `pending`, `granted`,
      or `denied`. Do not split it across contradictory booleans.
- [ ] Default the low-level core to `pending` unless a caller explicitly
      supplies another initial state. Documentation must explain that Prism
      provides enforcement primitives but does not decide an application's
      legal basis or make blanket compliance claims.
- [ ] While state is `pending` or `denied`, do not serialize or retain event
      properties in a hidden pre-consent queue. Return a dropped capture result
      with the reason.
- [ ] Transitioning to `denied` must clear queued analytics events and any
      SDK-owned persistent anonymous identifier through the storage adapter.
- [ ] Transitioning back to `granted` starts a new anonymous/session context;
      it must not resurrect previously denied data.
- [ ] Use session-scoped anonymous persistence by default in the browser
      adapter. A persistent/local strategy is explicit opt-in and documented
      as enabling cross-session recognition.
- [ ] Do not derive or store an anonymous identifier through fingerprinting,
      IP/user-agent hashes, canvas, installed fonts, or other covert signals.
- [ ] Add a property sanitizer on both client and server. Matching is
      case-insensitive and covers obvious credential/secret fields such as
      password, passcode, token, authorization, cookie, secret, API key,
      credit-card/security-code variants, and configured custom deny-list
      entries.
- [ ] Decide whether a matching key is removed or replaced with a stable
      `[REDACTED]` marker. Apply one deterministic policy and test nested
      objects/arrays without logging the rejected value.
- [ ] Do not automatically capture URL query strings, fragments, form values,
      DOM text, clipboard data, request/response bodies, headers, or console
      output in this task.
- [ ] Process client IPs only transiently for rate limiting and optional coarse
      geolocation. Remove the raw `ip` column from the v2 session model and
      verify no controller, WebSocket payload, management response, backup
      example, or log persists it.
- [ ] If map compatibility retains coordinates derived from IP, store only
      documented coarse/rounded coordinates or a country/city centroid. Label
      the dashboard location approximate; never imply device GPS precision.
- [ ] Keep IP enrichment optional and non-blocking. Ingestion must succeed with
      null geo fields when enrichment is disabled, times out, returns malformed
      data, or fails.
- [ ] Add project/operator documentation for collection state, persistent
      anonymous identity, retention, deletion limitations, event-property PII,
      and self-hosted data ownership.

## 5. Build the runtime-neutral core and adapter seams

- [ ] Remove all direct `window`, `document`, `navigator`, `Blob`,
      `process.env`, Worker binding, and unconditional global `fetch` access
      from `@prism/core`.
- [ ] Define focused adapter interfaces for transport, durable key/value or
      queue storage, clock, ID generation, runtime context, and optional
      lifecycle signals. Avoid one giant adapter full of optional methods.
- [ ] Keep requirements distinct from best-effort capabilities. Missing
      transport/clock/ID generation must fail client creation; optional durable
      storage may fall back to documented in-memory behavior.
- [ ] Do not expose ambient platform names merely to branch core behavior.
      Adapters provide capabilities and normalized context.
- [ ] Make client initialization load persisted queue/identity state, validate
      configuration, and resolve only when the returned client is ready.
- [ ] Ensure importing `@prism/core` has no side effects, timers, listeners,
      network requests, or environment reads.
- [ ] Keep `src/index.ts` as a barrel of direct exports. Split client, config,
      event contracts, capture results, diagnostics, adapters, queue, retry,
      validation, privacy, and session logic into focused modules.
- [ ] Keep typical source files between 200 and 400 lines and below the
      repository's 800-line maximum. Do not replace the current small client
      with one monolithic SDK file.
- [ ] Keep dependencies minimal and runtime-portable. Justify every runtime
      dependency with bundle-size, browser, Node, and React Native compatibility
      evidence; prefer owned small utilities for the narrow core behaviors.
- [ ] Export both ESM and supported compatibility output with correct
      `exports`, `types`, tree-shaking metadata, and source maps. Test package
      consumption from a clean fixture rather than only workspace resolution.
- [ ] Add a bundle-size report/budget based on the implemented baseline. Do
      not add a large framework or schema library to the public runtime merely
      for internal convenience.
- [ ] Prove with tests that the package imports and creates a client in a Node
      test process where DOM globals are absent.
- [ ] Prove with a fake native/mobile adapter that screens, app metadata, and
      foreground/background lifecycle context can be represented without
      platform-specific fields in core.

## 6. Implement a dependable queue, batching, and delivery lifecycle

- [ ] Enqueue immutable event copies. Mutating the caller's properties object
      after `track()` must not alter the queued or delivered payload.
- [ ] Preserve FIFO order within one client while allowing the server to query
      by occurrence time. Document that retries can cause batches to arrive
      later without duplicating accepted events.
- [ ] Support configurable batch size, flush interval in milliseconds, maximum
      queue events/bytes, retry count, retry backoff, and shutdown timeout with
      safe documented defaults and bounded ranges.
- [ ] Use one in-flight flush per client. Concurrent `flush()` calls share or
      serialize the same work; they must not send duplicate concurrent batches.
- [ ] Flush on batch threshold, interval, explicit `flush()`, and adapter-owned
      lifecycle/shutdown signals. Core must not install browser lifecycle
      listeners itself.
- [ ] Retry only external nondeterminism: network failures, request timeout,
      `408`, `429`, and retryable `5xx` responses. Honor a valid `Retry-After`
      header and use bounded exponential backoff with jitter.
- [ ] Do not retry permanent `400`, `401`, `403`, or `413` responses unchanged.
      Return/surface a specific diagnostic that names remediation without
      exposing the key or event body.
- [ ] Put a timeout and cancellation signal on every transport attempt. Timers
      must be owned and cleaned up; tests use fake clocks rather than sleeps.
- [ ] Define queue-overflow behavior. Prefer dropping the oldest unflushed
      event only after the configured bound is reached, emit a diagnostic, and
      return an observable result for the triggering capture. Never allow
      unbounded memory or storage growth.
- [ ] Persist the queue through the injected storage adapter using namespaced,
      versioned keys. Corrupt or future-version state is quarantined/cleared
      with a diagnostic rather than crashing the host.
- [ ] Prevent two tabs/processes sharing one storage namespace from endlessly
      duplicating the same queue. Either implement a documented ownership/
      lease strategy in the browser adapter or deliberately namespace clients
      per execution context and record the tradeoff.
- [ ] Treat server `accepted`, `duplicate`, and `rejected` results separately.
      Remove accepted/duplicate IDs, retain only retryable failures, and never
      resend permanently rejected poison events forever.
- [ ] Make `shutdown()` idempotent and terminal. It removes subscriptions,
      stops scheduling, performs the bounded final flush, and produces a clear
      result/error if delivery cannot finish before `timeoutMs`.
- [ ] Keep normal background delivery quiet. Diagnostics are disabled unless
      subscribed/configured; no `console.log`/`console.error` calls exist in
      package runtime code.

## 7. Establish explicit, cross-runtime session semantics

- [ ] Generate session IDs locally so capture never depends on a session-start
      network round trip.
- [ ] Decide and document three valid workflows: adapter-managed sessions for
      browser/native applications, manually controlled sessions for advanced
      integrations, and sessionless events for server/API runtimes.
- [ ] Do not force a Node/Hono process to become one never-ending browser-like
      session. Session presence is a meaningful envelope variant, not a fake
      empty ID.
- [ ] Define start, activity, inactivity, rotation, and end semantics in core.
      Put timeout units in names and use the injected clock.
- [ ] Ensure a session start/end transition can be queued offline and remains
      idempotent on retry.
- [ ] Decide whether sessions are first-class ingestion records or derived/
      upserted from event envelopes. Prefer one transactional write path that
      cannot create an event pointing at an unavailable session.
- [ ] Preserve current realtime behavior by emitting a project-scoped session
      connection after the first accepted session activity, not merely after a
      client constructor runs.
- [ ] Scope session end/update by both authenticated project ID and session ID.
      Retain the existing cross-project security test.
- [ ] Mark abandoned sessions stale server-side through documented last-seen
      semantics; do not trust `unload` delivery as guaranteed.
- [ ] Add tests for inactivity rotation, clock changes, offline start/end,
      duplicate lifecycle records, manual sessions, sessionless events, and
      shutdown during an active session.

## 8. Add a versioned, idempotent batch-ingestion API

- [ ] Add the chosen v2 ingestion route behind the existing public write-key
      authentication boundary. The key derives the project; client-provided
      project/team/user ownership fields are ignored or rejected.
- [ ] Validate content type and enforce request byte limits before allocating
      or parsing an arbitrarily large body.
- [ ] Validate the batch envelope and each event using shared contract fixtures
      and server-owned runtime validation. TypeScript types alone are not a
      trust boundary.
- [ ] Define partial-batch behavior explicitly. Prefer event-level accepted,
      duplicate, and rejected results keyed only by event ID/index, without
      echoing properties or sensitive values.
- [ ] Add a uniqueness constraint on `(project_id, event_id)` and use conflict-
      safe inserts so transport retries cannot duplicate analytics.
- [ ] Keep write-key/project scoping in every session/event mutation and test
      cross-project event IDs, session IDs, and replay attempts.
- [ ] Sanitize on the server even when the official SDK already sanitized.
      Direct HTTP clients are untrusted.
- [ ] Add event-weighted abuse protection in addition to request/IP limiting;
      batching must not multiply the current effective ingestion allowance by
      the batch size without a deliberate configured quota.
- [ ] Preserve CORS behavior required by public browser ingestion while never
      adding credentialed wildcard CORS.
- [ ] Use coarse error codes and safe response envelopes. Never return SQL,
      internal table names, write keys, full payloads, IPs, or provider errors.
- [ ] Ensure logs include safe correlation/event IDs and counts only. The
      existing redaction layer remains defense in depth; ingestion bodies are
      never logged.
- [ ] Add readiness behavior for the analytics store without making optional
      enrichment a readiness dependency.
- [ ] Add API reference fixtures/examples for successful, duplicate, partially
      rejected, unauthorized, rate-limited, and oversized batches.

## 9. Replace the analytics schema with a migration-owned v2 model

- [ ] Introduce ordered analytics migrations and a migration journal rather
      than growing one idempotent setup SQL file forever. The migration runner
      must work for hosted Turso/libSQL and packaged sqld.
- [ ] Keep forward migrations as the production contract. A separate guarded
      reset command may exist for disposable development/test stores.
- [ ] Add an `events` v2 model containing stable event ID, project ID, type,
      name where applicable, schema version, occurrence/receive timestamps,
      optional session/anonymous IDs, properties JSON, and normalized context.
- [ ] Add uniqueness and query indexes for project/time, project/name/time,
      session/time, and anonymous identity where justified by the next query
      stages. Verify plans on representative data rather than indexing every
      column speculatively.
- [ ] Add or revise the session model for client-generated IDs, start/end/
      last-seen timestamps, runtime/device/browser/OS context, approximate geo,
      and online/stale status.
- [ ] Remove raw IP from persistent schema, resources, queries, WebSocket
      messages, fixtures, integration tests, backup examples, and documentation.
- [ ] Do not create person/profile/group tables in this task. Reserve nullable
      identity fields only where the Task 10 model can adopt them without
      rewriting the event envelope.
- [ ] Decide JSON storage/query strategy for libSQL. Preserve exact JSON-safe
      values and add generated/extracted columns only for measured query needs.
- [ ] Make retention delete dependent records in a safe order/transaction and
      operate on the v2 timestamps. Preserve `--status`, `--dry-run`, apply,
      idempotency, and redacted output tests.
- [ ] Add a guarded development migration/reset procedure that prints the
      resolved non-secret target identity, refuses non-approved production
      targets, and requires an explicit confirmation flag before deleting the
      disposable legacy sessions/events.
- [ ] Inspect the configured analytics store before applying the destructive
      reset. Record table counts/schema, apply migration, run inspection again,
      and verify only expected analytics test data was removed.
- [ ] Update backup/restore and self-hosting schema expectations so a new v2
      database and a restored v2 database pass the same readiness checks.

## 10. Preserve honest management APIs, realtime, and dashboard behavior

- [ ] Update product API analytics reads to the v2 schema with parameterized
      database queries and project/team authorization unchanged.
- [ ] Stop deriving total event metrics from a latest-200 array. Use a real
      aggregate count for the selected project/date range.
- [ ] Rename any session count labeled `Visitors` until unique-visitor
      semantics exist, or compute a documented anonymous-visitor count from
      the new session-scoped identifier. Do not imply cross-session uniqueness
      before Task 10/11 supports it.
- [ ] Move summary aggregation into bounded database queries rather than
      loading every session row into application memory.
- [ ] Keep the existing event table usable with v2 names, properties, session,
      occurred time, and delayed receive time. Advanced filters/pagination UI
      remain Task 12, but the current list must not misrepresent totals.
- [ ] Decode stored JSON at the API boundary into a typed JSON value rather
      than returning a JSON string that the dashboard prints verbatim.
- [ ] Update `EventResource`, `SessionResource`, WebSocket message types, query
      hooks, loading/error/empty states, and tests together. Do not preserve
      stale snake_case database resources as the public management contract
      merely because the old table used them.
- [ ] Keep realtime session updates project-scoped and authorized through the
      existing service JWT/member verification path.
- [ ] Ensure approximate/null geo still renders a useful non-map session row
      and does not break Mapbox-optional behavior.
- [ ] Verify onboarding's first-event poll and landing/docs examples against
      the new endpoint and SDK API.
- [ ] Remove old v1 routes, response types, controller methods, stores, docs,
      and dead schema only after all consumers have moved.

## 11. Add the minimal browser runtime after core passes

- [ ] Create `@prism/browser` only after the core contract, core tests, and
      Node-without-DOM import test are green.
- [ ] Implement browser transport, clock/ID adapters where required, runtime
      context, session/local/memory storage strategies, and lifecycle cleanup
      without copying core queue/session/privacy logic.
- [ ] Require a runtime `endpoint` option; remove `API_URL` build substitution
      from `@prism/core` and its build scripts.
- [ ] Capture only the currently approved minimal context: sanitized path,
      safe referrer, locale/timezone, viewport/device classification, and
      browser/OS data needed for existing reports. Query strings, hashes, DOM
      content, form values, and click targets remain excluded.
- [ ] Prefer server parsing of the request User-Agent where practical and
      discard the raw value after deriving coarse fields. Do not persist a
      second raw user-agent copy in event properties.
- [ ] Use browser lifecycle signals to request bounded flush/session updates,
      but keep stale-session handling authoritative because unload events are
      unreliable.
- [ ] If `sendBeacon` cannot carry write-key authentication safely, do not send
      an unauthenticated fallback and imply success. Use an authenticated
      keepalive transport or leave the event queued for the next lifecycle.
- [ ] Clean up every browser listener, timer, lock/lease, and storage
      subscription during shutdown.
- [ ] Add browser tests for reload persistence, two-tab behavior, offline/
      online transitions, denied consent, storage denial/quota errors,
      lifecycle flush, sanitized URL/referrer, and deterministic cleanup.
- [ ] Add a package-consumer smoke fixture using only public exports and an
      explicit self-hosted endpoint.

## 12. Adapt React only after core and browser are complete

- [ ] Keep `@prism/react` a thin adapter over an already-created browser/core
      client. It must not create a second queue, session, event envelope,
      consent store, or retry policy.
- [ ] Replace the class provider's `MutationObserver` pathname logger and
      uncleaned `popstate` listener with deterministic provider ownership and
      cleanup. Automatic route/page tracking remains Task 11.
- [ ] Preserve a stable imperative client through context. Hooks expose bound,
      stable core methods without recreating callbacks on every render.
- [ ] Do not turn the React provider into an error boundary or exception SDK in
      this task. Remove console-only error handling; error capture is a later
      observability capability.
- [ ] Decide whether the provider accepts a ready client or an initialization
      config. Prefer a ready client if that avoids half-initialized context and
      makes non-React ownership/cleanup explicit.
- [ ] Add React Strict Mode tests proving one client/session, no duplicate
      events, deterministic cleanup, and no updates after unmount.
- [ ] Test React 18 and React 19 peer compatibility using the existing peer
      range; do not import React from `@prism/core` or `@prism/browser`.
- [ ] Update `usePrism` to return the stable client or a focused typed facade.
      Remove `logCustomEvent` unless contract review finds a distinct semantic
      reason to keep it; prefer the industry-familiar `track` command.
- [ ] Keep Vue/React Native/Node adapters out of this implementation. Record
      adapter authoring guidance so they can reproduce the thin-binding pattern
      later.

## 13. Testing and verification strategy

- [ ] Use TDD for core state machines, queue/retry behavior, ingestion
      validation, deduplication, privacy transitions, and migrations: failing
      test first, minimal implementation, refactor with gates green.
- [ ] Add a dedicated test script and coverage gate for `@prism/core`; enforce
      at least 80% statements, branches, functions, and lines for the new core
      rather than hiding it inside repository-wide averages.
- [ ] Add `@prism/browser` and `@prism/react` tests with at least 80% coverage
      for changed behavior and all privacy/lifecycle branches.
- [ ] Unit-test JSON validation, immutable cloning, redaction, ID/session
      generation, timestamp handling, consent transitions, queue overflow,
      persistence corruption, retry classification, `Retry-After`, timeout,
      cancellation, concurrent flush, shutdown, and diagnostic subscriptions.
- [ ] Contract-test SDK-produced fixtures against the server validator.
      Prevent independent client/server definitions from silently drifting.
- [ ] Test malformed/oversized bodies, prototype-pollution attempts, deep
      properties, invalid JSON values, wrong keys, cross-project IDs, duplicate
      events, rate limiting, enrichment failure, and redacted logs.
- [ ] Add isolated libSQL integration tests for migration from/reset of the
      current schema, fresh bootstrap, idempotent migration, batch insert,
      deduplication, partial rejection, aggregate reads, retention, and restore.
- [ ] Add a no-DOM Node smoke test and a fake-native runtime contract test.
      These are architecture gates even though `@prism/node` and
      `@prism/react-native` are not implemented yet.
- [ ] Update the existing end-to-end smoke journey: create owner/account,
      create team/project, initialize SDK with explicit endpoint/collection
      state, record session/event, read it in the dashboard, and confirm
      retention/authorization boundaries.
- [ ] Verify the browser SDK never sends to Prism cloud when configured with a
      self-hosted endpoint. Add a test that fails if a hosted origin is embedded
      in a self-hosted build artifact.
- [ ] Verify raw IP sentinel values never appear in analytics rows, resources,
      WebSocket messages, application logs, backups produced during the test,
      or SDK diagnostics.
- [ ] Run build, typecheck, lint, unit, integration, E2E smoke, coverage, audit,
      package-consumer, and documentation-drift gates before closure.

## 14. Documentation and developer experience

- [ ] Update the Fumadocs architecture/concepts pages to distinguish core,
      runtime adapters, framework adapters, ingestion, analytics storage, and
      management/read paths.
- [ ] Rewrite the JavaScript SDK reference around the reviewed v2 public API,
      explicit endpoint, collection state, capture results, flush, shutdown,
      sessions, diagnostics, delivery guarantees, and limits.
- [ ] Add a focused privacy/consent SDK guide with pending/granted/denied
      examples, persistent-anonymous opt-in, redaction, IP handling, and a clear
      statement that configuration is not legal advice.
- [ ] Rewrite the ingestion API reference with the exact v2 batch schema,
      authentication, limits, partial results, deduplication, timestamps,
      errors, and safe retry behavior.
- [ ] Update hosted and self-hosted quickstarts. Both use the same package API;
      only endpoint/configuration differs.
- [ ] Remove the current instruction that a self-hosted operator must rebuild
      the SDK with `API_URL`. A normal runtime option is the supported path.
- [ ] Update events, sessions, realtime, retention, backup/restore, networking,
      logging, and security pages from verified source behavior.
- [ ] Correct existing privacy documentation that says events have no
      retention deletion when `ANALYTICS_RETENTION_DAYS` now applies to events
      and sessions.
- [ ] Document delivery semantics honestly: queued is not delivered, flush can
      fail, unload delivery is best-effort, duplicates are deduplicated by
      event ID, and rejected events are reported without payload echoing.
- [ ] Add framework-author guidance explaining that adapters inject runtime
      capabilities and lifecycle only. Include future React Native and Node/
      Hono examples as architecture sketches clearly labeled planned, not
      available packages.
- [ ] Add API/type documentation generation or a declaration/docs drift test
      so exported types and prose cannot diverge silently.
- [ ] Do not claim packages are published to npm until the recovered/final
      scope is controlled and a release is actually available.

## 15. Security and operational review

- [ ] Review the public write-key threat model after batching. Confirm keys are
      write-only, project-scoped, rotatable through existing project settings,
      and unable to read analytics or mutate another project.
- [ ] Review denial-of-service bounds for body size, batch count, event size,
      nested JSON, queue growth, retry storms, and event-weighted rate limits.
- [ ] Review CORS, proxy IP trust, optional geo egress, timeout, and log
      redaction with hosted and self-hosted configurations.
- [ ] Verify no project key, event body, anonymous identifier, IP, authorization
      header, or storage contents appear in normal logs or thrown error text.
- [ ] Verify consent denial clears only Prism-owned analytics keys/queue data;
      it must never clear unrelated host application storage.
- [ ] Verify storage namespaces include project and endpoint identity so two
      Prism projects/instances cannot consume or transmit each other's queue.
- [ ] Verify endpoint changes cannot silently send a persisted queue from one
      instance to another. Either bind queued events to their original endpoint
      or require an explicit safe migration/drop decision.
- [ ] Run the repository audit gate and review new dependencies/licenses before
      any commit that changes package runtime dependencies.
- [ ] Perform a final correctness and security review of the complete diff;
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

- [ ] The reviewed SDK/ingestion ADR and public TypeScript contract are checked
      in and match the implementation.
- [ ] `@prism/core` has no platform globals or import-time side effects.
- [ ] The ready client supports explicit track, observable capture outcomes,
      consent transitions, sessions/sessionless operation, diagnostics, flush,
      and deterministic shutdown.
- [ ] Events generated before any network response are queued rather than
      discarded.
- [ ] Runtime endpoint configuration works in hosted and self-hosted examples;
      no SDK rebuild is required.
- [ ] v2 batch ingestion validates, sanitizes, scopes, rate-limits, persists,
      and deduplicates events safely.
- [ ] The analytics schema is migration-owned, inspected, backed up/restorable,
      and contains no raw IP field/data.
- [ ] Existing sessions/events/realtime/onboarding journeys work on v2, and
      dashboard labels/counts are honest.
- [ ] The minimal browser adapter and existing React wrapper contain no copied
      core analytics logic and clean up deterministically.
- [ ] No autocapture, identity profile, observability, or unimplemented
      framework method is presented as available.
- [ ] Core/browser/React changed code meets the 80% coverage gates and all
      contract/integration/E2E/privacy/security tests pass.
- [ ] Monorepo build, typecheck, lint, test, audit, docs drift, package-consumer,
      and self-hosted endpoint gates are green.
- [ ] Working tree is clean, implementation is committed in reviewable slices,
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
     transport: { post: (url, body) => fetch(url, { method: "POST", body }) },
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
