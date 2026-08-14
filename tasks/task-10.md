# Task 10: Add identity, profiles, and the product-analytics baseline

## Goal

Turn Prism's dependable event/session foundation into a usable product-
analytics platform by adding the missing identity model, person profiles,
explicit user traits, global properties, baseline segmentation, and privacy
operations.

This is the first task in the post-foundation capability program. Prism is
product-analytics-first: identity, profiles, event exploration, segmentation,
funnels, retention, and cohorts come before session replay, error monitoring,
performance tracing, feature flags, or experiments.

The first delivery target is the web stack:

1. runtime-neutral behavior in `@prism/core`;
2. ingestion, identity storage, and read APIs;
3. `@prism/browser` integration;
4. thin `@prism/react` bindings;
5. hosted and self-hosted dashboard support.

React Native is a first-class future target, but no React Native package should
be implemented in this task. Every public contract and storage decision must be
compatible with a later `@prism/react-native` adapter for both Expo and bare
React Native.

## Status

Planned. Task 9 is complete and supplies the v2 event/session, ingestion,
browser, React, consent, queue, and delivery foundation.

There are no production users or analytics records that require compatibility
migration. Development analytics data is disposable, but database changes must
still use ordered migrations and the existing guarded reset procedure.

## Confirmed product decisions

- Prism remains product-analytics-first.
- `identify()` links the current anonymous history to the developer-supplied
  user ID.
- Raw events remain immutable. Identity resolution must use durable identity
  links rather than rewriting historical event rows.
- Names, email addresses, and all other PII are collected only when the
  developer explicitly supplies them.
- Autocapture is disabled by default. Task 10 must not introduce click, form,
  DOM, navigation, or input autocapture.
- Explicit page and screen tracking are separate future capabilities. Task 11
  owns page/screen and acquisition analytics.
- The future React Native package must support Expo and bare React Native. Its
  first release will provide analytics, identity, consent, and session parity,
  not replay, crashes, or performance monitoring.
- Every baseline and major product-analytics feature must work in self-hosted
  mode from its first release.
- Framework packages are adapters. Queueing, identity transitions, traits,
  consent, sanitization, and event construction remain in `@prism/core`.
- Task 9's forward reference provisionally grouped account analytics into Task
  10. This action sheet supersedes that routing: Task 10 establishes the person
  identity primitives, while full group/account reports belong to Task 12 with
  the other advanced product insights.

## Positioning and competitor frame

Use the competitor research as capability evidence, not as a requirement to
copy every vendor:

- Direct product-analytics references: PostHog, Amplitude, Mixpanel, Heap, and
  Firebase Analytics.
- Adjacent observability references: Sentry, LogRocket, and Datadog.
- Prism's differentiators remain self-hosting, privacy-conscious defaults,
  runtime-neutral core behavior, and framework adapters that do not fork the
  analytics implementation.

The direct products converge on custom events, anonymous and known identity,
user properties, sessions, trends, filters, breakdowns, profiles, funnels,
retention, cohorts, and dashboards. The adjacent products inform later error,
performance, breadcrumb, replay, and alerting work.

## Required end state

At completion:

- a developer can identify a signed-in user with a stable external ID and
  optional explicitly supplied traits;
- the user's current anonymous identity is linked to that external ID without
  mutating historical events;
- future events resolve to the identified person across sessions and devices;
- logout rotates the local identity and session so the next user cannot inherit
  the previous user's context;
- developers can set, unset, and clear safe global properties without repeating
  them on every `track()` call;
- the dashboard provides a project-scoped people list, profile details, traits,
  identity history, sessions, and event activity;
- event/session explorers support bounded filters and breakdowns by safe event,
  person, session, and context properties;
- project operators can export or delete a person's analytics data;
- consent denial never persists an identity link, traits, or hidden behavioral
  state;
- hosted and self-hosted deployments expose the same SDK, API, dashboard, data
  deletion, and export behavior;
- `@prism/browser` and `@prism/react` expose the new core capabilities without
  implementing their semantics;
- changed code meets the repository's 80% coverage floor, and critical identity
  transitions have integration and browser certification.

## Non-goals

Do not expand Task 10 into:

- automatic page views, navigation tracking, UTM/campaign attribution,
  referrer reports, landing pages, or bounce analytics — Task 11;
- funnels, retention, cohorts, paths, journeys, stickiness, or saved insights —
  Task 12;
- DOM/click/form/scroll autocapture;
- session replay, heatmaps, rage clicks, or dead clicks;
- exception/crash tracking, source maps, logs, Web Vitals, RUM, tracing, spans,
  or profiling;
- feature flags, remote configuration, experiments, or surveys;
- a production React Native, Vue, Svelte, Angular, Node, or Hono package;
- automatically collected names, email addresses, phone numbers, advertising
  identifiers, contact data, or exact location;
- npm publication or package-scope changes.

## 1. Freeze identity semantics before implementation

### ADR 0003 — person & identity model (task-10 §1)

Status: accepted. Date: 2026-08-13. (Tracked in this file; a local mirror
lives at engineering/adr/0003-identity-model.md — engineering/ is excluded
from git.)

#### Terminology

- **person**: Prism's resolved analytics subject (a project-scoped row in
  `people`). Not a synonym for "user account" or "visitor".
- **userId**: the CUSTOMER's external identifier, developer-supplied via
  `identify()`. Opaque string, documented ceilings, never inferred.
- **anonymousId**: SDK-generated, origin-scoped identity. Persistent or
  session-scoped per the collection configuration.
- **traits**: explicitly supplied profile attributes (set/unset only;
  counters/arrays/server-computed traits deferred).

#### Decisions

1. **Multiple anonymous IDs per person**: YES — one external userId may
   link many anonymous IDs (multi-browser, multi-device). Resolution is
   per-event: an event carrying `userId` resolves to the person by
   external ID; otherwise by its anonymous link; otherwise to an
   anonymous-only bucket.
2. **Conflict (anonymous identity linked to two external IDs)**: an
   anonymous ID keeps exactly ONE first-wins link to a known person —
   never a silent merge of two known people over a shared/recycled
   device. `identify(B)` while the current anonymous context belongs to
   A rotates to a FRESH anonymous context for B (the A-context events
   stay immutable under A); B's subsequent events carry userId=B and
   resolve to B's person via the external ID (which takes precedence
   over the stale anonymous link).
3. **Idempotency**: every identify/profile mutation carries a
   client-generated operation ID; the server deduplicates per project
   (unique constraint). Retried deliveries and duplicated op IDs are
   no-ops. Server processing is deterministic in operation order.
4. **Logout (`reset()`)**: closes the active session, clears the known
   userId/person context, rotates the anonymous ID, clears queued
   identify operations, and clears ALL global-property scopes
   (memory/session/persistent) — the next user can never inherit the
   previous user's context. Queued EVENTS keep their immutable identity
   context (serialized at enqueue time; never relabeled).
5. **Global-property scopes**: explicit `memory` | `session` |
   `persistent` (persistent requires storage). Per-event properties
   override globals for that event without mutating stored globals.
6. **Raw events are immutable**: historical association is resolved via
   durable identity links at query time (a derived association column is
   the only index added; it can be rebuilt). `identify()` never rewrites
   historical event rows.
7. **Consent**: denied/pending collection never persists identity
   links, traits, global properties, or queued identify operations.
   Withdrawal clears identity links + traits + globals consistently with
   the Task 9 privacy contract.
8. **Deletion**: person deletion removes identity links first (a future
   use of the same external userId creates a NEW person — deleted
   history never silently returns), then traits, then events
   (anonymization vs removal decided in §6: REMOVE, documented).
9. **Threat model (recorded)**: identity merging via shared devices is
   prevented by first-wins links + userId precedence + fresh anonymous
   rotation; user-ID guessing is mitigated by treating IDs as opaque and
   bounding search to exact match + explicitly indexed safe traits;
   trait poisoning is bounded by strict JSON/dangerous-key/redaction
   rules + project-scoped writes; cross-project access is prevented by
   deriving the project exclusively from the authenticated key;
   deletion races are handled by operation idempotency + transaction
   ordering; enumeration through search/error responses is prevented by
   coarse error codes and exact-match-only search.
10. **Self-hosted parity**: everything above ships in the same release
    for hosted and self-hosted deployments.

#### Inventory before implementation (task-9 state, recorded)

- Event schema: `events` (id, project_id, type, name, schema_version,
  occurred_at, received_at, session_id, anonymous_id, properties,
  context, sdk_name, sdk_version; PK (project_id, id)).
- Envelope v2: schemaVersion 2, sentAt, sdk, events[]; project derived
  from the key.
- Queue persistence: v3 owner-segmented snapshot (owner, eventId, name,
  occurredAt, serialized).
- Browser identity key: `prism:anonymous_id` (localStorage, origin-
  scoped); queue keys in sessionStorage `prism:queue:v2:<endpoint-
  hash>:<projectKey>`.
- Consent: pending/granted/denied; withdrawal clears queue + identity +
  session; re-grant rotates identity.
- Dashboard reads: analyticsStore.ts (bounded aggregates), events list,
  realtime sessions.
- Retention CLI: events by received_at, sessions_v2 by last_seen_at.
- Certification: certify-v2-ingest.mjs (23/23) + restart drill.



- [x] Add an ADR for Prism's person and identity model. Record anonymous IDs,
      developer-supplied user IDs, identity links, profile ownership, trait
      updates, cross-device resolution, logout/reset behavior, consent effects,
      deletion, retention, and self-hosted parity.
- [x] Inventory the Task 9 event/session schema, ingestion envelope, queue
      persistence, browser identity keys, consent transitions, dashboard reads,
      retention CLI, and certification scripts before changing them.
- [x] Define terminology consistently: `person` is Prism's resolved analytics
      subject, `userId` is the customer's external identifier, `anonymousId` is
      SDK-generated, and `traits` are explicitly supplied profile attributes.
- [x] Specify whether one external user may link multiple anonymous IDs and
      ensure the answer supports multiple browsers/devices.
- [x] Specify conflict behavior when an anonymous identity is linked to two
      different external user IDs. Fail safely; never silently merge two known
      people because of a shared or recycled device.
- [x] Specify idempotency for repeated `identify()` calls and retry-safe server
      processing.
- [x] Specify logout behavior. `reset()` must close the active session, clear
      the known user, rotate the anonymous ID, and prevent queued or persistent
      state from crossing into the next user's context.
- [x] Decide which global properties survive `reset()`. Prefer explicit scopes
      (`memory`, `session`, or `persistent`) over surprising implicit behavior.
- [x] Record that raw events are immutable. Historical association is resolved
      through identity links at query time or a derived projection that can be
      rebuilt; do not update every historical event on `identify()`.
- [x] Threat-model identity merging, shared devices, user-ID guessing, trait
      poisoning, cross-project access, deletion races, and enumeration through
      search/error responses.

## 2. Freeze the public core contract with failing tests

- [x] Propose the smallest runtime-neutral TypeScript contract before coding.
      At minimum cover `identify`, `reset`, trait updates, global properties,
      current identity inspection, capture results, and diagnostics.
- [x] Keep identity methods asynchronous where durable storage or delivery is
      required. Do not report success before the state is safely committed.
- [x] Make `identify(userId, traits?)` link the current anonymous identity and
      apply optional traits in one ordered operation.
- [x] Do not add `alias()` merely for competitor API familiarity. Add it only
      if the ADR identifies a separate safe use case that `identify()` cannot
      represent.
- [x] Define trait mutation operations deliberately. Support safe set/unset
      semantics; defer counters, array mutation operators, or server-computed
      traits unless a current requirement needs them.
- [x] Define global-property operations with clear persistence and precedence.
      Per-event properties should override global properties for that event
      without mutating stored global state.
- [x] Return discriminated results for rejected IDs, denied consent, invalid
      traits, storage failures, and delivery failures. Do not use console output
      as the public error contract.
- [x] Add type-level tests proving the contract imports in plain Node without
      DOM or React types.
- [x] Add failing behavioral tests for anonymous-to-known linking, repeated
      identify, cross-device linking, reset, consent denial, re-grant, storage
      failure, global-property precedence, and global-property persistence.
- [x] Add React Native-shaped fake runtime tests now: asynchronous storage,
      foreground/background lifecycle, no DOM globals, and offline transport.


### §2/§3 status (2026-08-13)

- Contract additions frozen in contract.ts: `identify(userId, traits?)`
  (async, one ordered operation), `reset()` (async), global-property
  operations with explicit memory/session/persistent scopes, the
  `PrismIdentityState` getter, discriminated `IdentifyResult`/
  `ResetResult`/`GlobalPropertyResult` (reasons include
  invalid-user-id / invalid-traits / storage-failure), wire v3 types
  (`WireBatchV3`, `WireEventV3` with optional userId, `WireIdentifyOp`),
  `DropReason` extended.
- No `alias()` — the ADR found no separate safe use case `identify()`
  cannot represent (recorded).
- Trait mutations: identify supports SET/UPDATE via traits; UNSET is
  expressed with the reserved `$unset: string[]` key (deferred to §4's
  server processing). Counters/array mutation operators deferred.
- TDD: the 13 behavioral tests (identity.test.ts) were written red
  against the task-9 core and are green with §3; the RN-shaped fake
  runtime test (async storage, lifecycle, no DOM, offline transport)
  is included.
- Core implementation: identity state machine, conflict-safe anonymous
  rotation, reset (session close + identity rotate + op purge + all
  global scopes cleared + queued-event isolation), global-property
  merge with precedence (persistent < session < memory < per-event),
  withdrawal clears identity links/ops/globals, storage-failure
  in-memory stability with coarse diagnostics, queue snapshot v4
  (kind-tagged entries) with id-based batch removal, batch envelope v3
  (identity ops delivered before events), `WIRE_SCHEMA_VERSION` = 3.
- Core suite: 135 tests green (122 task-9 + 13 identity).


## 3. Implement identity and global properties in `@prism/core`

- [x] Implement the approved identity state machine in `@prism/core` only.
- [x] Validate external user IDs with documented length and character ceilings.
      Treat IDs as opaque strings; do not require email-shaped values.
- [x] Apply the shared strict-JSON, dangerous-key, depth, size, and redaction
      rules to traits and global properties.
- [x] Never infer or automatically capture email, name, phone, advertising ID,
      exact location, contacts, clipboard contents, or input values.
- [x] Preserve operation ordering so `identify()` followed immediately by
      `track()` cannot attach the event to stale identity state.
- [x] Make repeated identical `identify()` operations idempotent.
- [x] Keep one stable in-memory state if persistent storage fails, emit a safe
      diagnostic, and never leak IDs or trait values in diagnostics.
- [x] Ensure denied or pending collection cannot persist identity links, traits,
      global properties, or queued identify operations.
- [x] On consent withdrawal, clear collection-related identity and property
      state consistently with the Task 9 privacy contract.
- [x] On `reset()`, isolate queued events by their original immutable identity
      context; never relabel an already queued event as belonging to a new user.
- [x] Add configurable memory/session/persistent scopes for global properties if
      approved by the contract.
- [x] Keep the core free of browser, React, React Native, Node, Cloudflare, and
      database imports.
- [x] Maintain at least 80% changed-code coverage, with identity transitions and
      consent/reset branches targeted above 90%.


### §4 status (2026-08-13)

- Migration 005_identity.sql: people, external_identities,
  anonymous_identities, person_traits, identity_ops + the events table
  gains immutable user_id + derived person_id + the person index.
- Deterministic person ids (u_/a_ sha256) make concurrent identifies
  converge on ONE person; links are first-wins (an anonymous id is never
  re-linked over a shared device); anonymous-only history is reassigned
  to the known person (derived projection rebuild — raw events
  untouched); op ids dedupe retries (pre-read + PK).
- Batch envelope v3: schemaVersion 2|3 accepted, events may carry
  userId, identity ops validated with the same ceilings; identity
  outcomes in the response; project still derived exclusively from the
  key.
- Retention now purges events → sessions → links → traits → people in
  dependency-safe order, one atomic batch; retention tests updated.
- Verified: in-memory libSQL (migration + controller tests) AND the
  packaged sqld runtime (005 applied; the full identity flow —
  deterministic person, traits, first-wins link, op replay idempotency —
  exercised against real sqld).
- Core $unset convention: identify traits may carry `$unset: string[]`
  (validated, extracted, never stored as a trait).


## 4. Add versioned ingestion and identity storage

- [x] Extend the ingestion contract through an explicit compatible schema
      version or a new versioned boundary; do not silently reinterpret existing
      v2 fields.
- [x] Add client-generated operation IDs so identify/profile mutations are safe
      to retry and deduplicate.
- [x] Derive the project exclusively from the authenticated project key.
      Ignore or reject client-supplied project ownership fields.
- [x] Add ordered libSQL/sqld/Turso migrations and journal entries for people,
      external identities, anonymous identity links, traits, and mutation
      idempotency.
- [x] Enforce project-scoped uniqueness for external user IDs and identity
      links.
- [x] Use database constraints and transactions to prevent partial person/link/
      trait state.
- [x] Preserve raw event immutability. Add only the minimum indexed identity
      fields or derived association needed for bounded queries.
- [x] Define deterministic conflict handling for concurrent identify calls.
- [x] Ensure errors return coarse codes without IDs, traits, SQL, URLs, keys, or
      database details.
- [x] Update retention so expired people, identities, traits, sessions, and
      events are removed in dependency-safe order.
- [x] Update backup/restore and migration certification for the new tables.
- [x] Verify migrations against both in-memory libSQL and the packaged sqld
      runtime; retain opt-in hosted Turso verification.


### §5 status (2026-08-13)

- People list: bounded keyset pagination (last_seen, person_id), honest
  counts (event occurrences, DISTINCT sessions, identity links),
  exact-match search by external ID and indexed safe traits (no
  prefix/fuzzy — documented limitation).
- Person detail: traits (primitive + object JSON decoded at the
  boundary), all linked external + anonymous identities.
- Person activity: bounded chronological event timeline.
- Events explorer: date range, name, person, session, and safe
  property-value filters (parameterized json_extract).
- Breakdowns: event / person / session / context-kind / context-platform
  with bounded cardinality (LIMIT 100).
- Honest totals: events ≠ people ≠ anonymous identities ≠ sessions
  (four distinct metrics).
- Malformed stored JSON quarantined to null — never crashes a response.
- Query-plan tests justify the person + identity indexes on
  representative data (EXPLAIN QUERY PLAN → USING INDEX).
- Every read project-scoped before filtering/pagination.
- api suite: 122 passed + 4 opt-in; people store: 12 real-libSQL tests.


## 5. Add people and baseline query APIs

- [x] Add authenticated, team/project-authorized APIs for a bounded people list
      and person details.
- [x] Support cursor pagination; never load an unbounded project's people,
      sessions, or events into application memory.
- [x] Allow people search by exact external ID and explicitly indexed safe
      traits. Avoid broad PII enumeration and document search limitations.
- [x] Return current safe traits, first/last seen times, identity count, session
      count, and event count without exposing internal database identifiers that
      clients do not need.
- [x] Add a bounded, chronological person activity endpoint covering sessions
      and events.
- [x] Extend event/session queries with date range, event name, person,
      session, and safe property filters.
- [x] Add breakdowns for event, person, session, and approved context properties
      using parameterized SQL and bounded cardinality.
- [x] Support honest totals: event occurrences, unique resolved people, unique
      anonymous identities, and sessions must remain distinct metrics.
- [x] Treat malformed stored JSON as a boundary error or quarantined value;
      never crash an entire response.
- [x] Add query-plan tests for representative data and justify every new index.
- [x] Ensure every read is project-scoped before filtering or pagination.


### §6 status (2026-08-13)

- Person export: documented analytics data only (identity references,
  traits, sessions, events) — never keys, tokens, raw IPs, or other
  users' data (asserted); 404 for unknown persons.
- Destructive deletion: explicit ?confirm=true contract, atomic
  dependency-safe batch (links FIRST → traits → events → person row),
  idempotent retries (re-delete is a safe no-op), coarse outcomes.
- Deletion removes identity links first — a future identify with the
  SAME external userId creates a NEW person with a clean slate (deleted
  history never silently returns — proven e2e).
- Decision recorded: deletion REMOVES raw events (not anonymization) —
  privacy over aggregate accuracy for person deletions.
- Cross-project isolation proven (deleting in one project never touches
  another).
- Real-sqld opt-in e2e: export → deletion during ingestion → export
  after deletion → repeated deletion → re-identify (fresh person) →
  cross-project denial.


## 6. Add privacy export and deletion operations

- [x] Add a project-authorized person export containing documented analytics
      data only: identity references, traits, sessions, and events.
- [x] Add an explicit destructive person-deletion workflow with confirmation,
      audit metadata, and idempotent retry behavior.
- [x] Decide whether deletion removes raw events or irreversibly anonymizes
      them. Document the privacy and aggregate-accuracy tradeoff before coding.
- [x] Ensure deletion removes identity links so a future use of the same
      external user ID does not silently restore deleted history.
- [x] Prevent deleted persistent anonymous identities from being recreated from
      stale SDK state without a new identity context.
- [x] Keep exported files and deletion logs free of project keys, auth tokens,
      raw IP data, or unrelated users' information.
- [x] Provide identical operations and documentation for hosted and self-hosted
      deployments.
- [x] Add integration tests for cross-project denial, repeated deletion,
      deletion during ingestion, and export after deletion.


### §7 status (2026-08-13)

- Browser: queue snapshots + session-scope globals in sessionStorage
  (per execution context); persistent-scope globals in localStorage;
  identity keys origin-shared by design; endpoint+project namespacing
  proven (two endpoints → two distinct storage namespaces).
- React: usePrism() facade extended with identify/reset/global-property
  methods (bound, stable) + a LIVE identity getter; PrismProvider stays
  zero-effect / Strict-Mode safe; React 18 fixture unchanged and green.
- Browser tests: identify attaches userId to subsequent events,
  persistent/session scope persistence + reload restore, reset clears
  identity + all scopes (shared-device safety), endpoint namespacing —
  29 tests total (98.6/85.1/94.7 coverage).
- React tests: 13 (facade surface + live identity getter).


## 7. Integrate `@prism/browser` and `@prism/react`

- [x] Extend `@prism/browser` storage/runtime support for the approved identity
      and global-property scopes without duplicating core state transitions.
- [x] Namespace stored state by endpoint origin and project identity so changing
      instances cannot move profiles or queued data across deployments.
- [x] Coordinate browser tabs so identity/reset/property changes do not cause
      stale-tab overwrites or cross-user delivery.
- [x] Do not add page-view, click, form, DOM, input, or navigation autocapture.
- [x] Extend the stable `usePrism()` facade with the approved core methods.
- [x] Keep `PrismProvider` Strict-Mode safe and free of hidden document/router
      effects.
- [x] Test React 18 and the repository's current React version through packed
      consumer fixtures.
- [x] Add browser tests for reload persistence, multiple tabs, shared-device
      logout/login, denied consent, storage denial, and offline identify/track
      ordering.

## 8. Build the dashboard experience

- [ ] Add a People section to project navigation.
- [ ] Build a paginated people table with honest identity, last-seen, sessions,
      events, and explicitly selected trait columns.
- [ ] Build a person detail view with current traits, linked anonymous
      identities, sessions, and a chronological event timeline.
- [ ] Add filters and breakdown controls to the event/session views before
      introducing advanced chart types.
- [ ] Add empty, loading, permission, malformed-data, and API-error states using
      the Prism design system.
- [ ] Redact sensitive values by default and require deliberate disclosure for
      permitted trait values.
- [ ] Add export and delete actions with clear scope and destructive-action
      confirmation.
- [ ] Ensure keyboard access, visible focus, reduced-motion behavior, screen-
      reader labels, and responsive layouts.
- [ ] Do not label anonymous identities as people, visitors, or users when the
      metric actually represents sessions or anonymous IDs.

## 9. Documentation and certification

- [ ] Document the identity model with anonymous, identified, reset, consent,
      shared-device, and multi-device examples.
- [ ] Document that PII is developer-supplied only and list data that Prism
      never captures automatically.
- [ ] Document global-property scopes, precedence, persistence, and logout
      behavior.
- [ ] Update JavaScript/browser and React references from the public exported
      types and keep the API-reference drift test green.
- [ ] Add self-hosted migration, retention, export, deletion, backup, and
      restore guidance.
- [ ] Add a packed `@prism/core` consumer fixture using a fake native/runtime
      adapter and a packed browser/React fixture using a real endpoint.
- [ ] Certify the public-origin flow: anonymous events, identify with explicit
      traits, linked historical activity, subsequent identified events,
      dashboard profile, export, reset, new anonymous activity, deletion, and
      cross-project isolation.
- [ ] Run repository build, typecheck, lint, unit/integration tests, coverage,
      docs drift/build, audit gate, and the self-hosted certification.
- [ ] Record evidence and known limitations in this file before marking Task 10
      complete.

## Delivery slices

Execute in this order and commit each slice separately:

1. **Contract and ADR** — identity semantics, threat model, public API, failing
   tests, migration/query inventory.
2. **Core state** — identify/reset, traits, global properties, consent and
   storage behavior.
3. **Ingestion and storage** — versioned mutations, migrations, transactional
   identity graph, retention and backup/restore updates.
4. **Read APIs** — people, activity, filters, breakdowns, bounded queries, and
   query-plan evidence.
5. **Privacy operations** — export, deletion, audit behavior, and race tests.
6. **Browser and React** — persistence, multi-tab behavior, thin bindings, and
   consumer fixtures.
7. **Dashboard and docs** — people UI, explorers, documentation, accessibility,
   and full hosted/self-hosted certification.

Do not begin a later slice while release-blocking findings from the previous
slice remain open.

## Acceptance scenarios

- [ ] An anonymous browser records events, identifies as `customer-123`, and
      the profile view resolves both earlier anonymous and later identified
      activity without changing the raw event payloads.
- [ ] A second browser identifies as the same external user and appears under
      the same person while retaining its own anonymous/session history.
- [ ] Repeating the same identify operation creates no duplicate person, link,
      or trait mutation.
- [ ] A shared browser calls `reset()`, signs in as another user, and no queued,
      persistent, or displayed data crosses between the two people.
- [ ] Pending or denied consent produces no identity link, profile trait, global
      property, or hidden queued mutation.
- [ ] Traits containing credentials, dangerous keys, excessive depth, invalid
      JSON values, or oversized strings are rejected/redacted consistently by
      core and ingestion.
- [ ] A developer who supplies no PII causes Prism to store no name, email,
      phone, advertising identifier, contact data, or exact location.
- [ ] Person search, activity, export, and deletion cannot cross project/team
      authorization boundaries.
- [ ] The same flow passes through the public reverse-proxy origin in the
      packaged self-hosted stack.
- [ ] A fake React Native-shaped runtime passes core identity, storage,
      lifecycle, offline queue, consent, and reset contract tests without DOM
      globals.

## Capability action sheet

This section controls the broader roadmap. Do not mark a capability complete
because a placeholder API or partial screen exists.

### Tier 1 — expected product-analytics baseline

Already delivered by Task 9:

- [x] runtime endpoint and project-key configuration;
- [x] custom events with strict properties;
- [x] client-generated event and session IDs;
- [x] anonymous identity modes;
- [x] batching, retry, offline persistence, deduplication, and flush;
- [x] explicit consent and privacy sanitization;
- [x] basic event/session exploration;
- [x] hosted and self-hosted ingestion.

Task 10:

- [ ] known-user identification and anonymous-history linking;
- [ ] reset/logout identity isolation;
- [ ] explicitly supplied user traits and profiles;
- [ ] global/super properties;
- [ ] people list, profile, and activity timeline;
- [ ] event/session filters and safe property breakdowns;
- [ ] unique-person, unique-anonymous, session, and event metrics;
- [ ] person export and deletion;
- [ ] project-level identity/privacy documentation and controls.

Task 11 — explicit web and acquisition analytics:

- [ ] explicit page-view API in core/browser;
- [ ] explicit screen-view contract for future adapters;
- [ ] opt-in router helpers for React, then future Vue adapters;
- [ ] URL/path sanitization, referrer, UTM, campaign, landing/exit metrics;
- [ ] environment, release, app version, browser/OS, and device context;
- [ ] page/screen dashboards and acquisition reports;
- [ ] configurable sampling and visible ingestion quotas.

Task 12 — core product insights:

- [ ] saved charts and configurable dashboards;
- [ ] event trends and date-range comparison;
- [ ] funnels and conversion/drop-off analysis;
- [ ] retention analysis;
- [ ] behavioral cohorts and reusable segments;
- [ ] paths and journeys;
- [ ] stickiness and frequency analysis;
- [ ] group/account analytics;
- [ ] revenue events and LTV reporting;
- [ ] schema catalogue, tracking-plan warnings, and exportable reports.

### Tier 2 — important and widely used

- [ ] privacy-masked web session replay;
- [ ] opt-in web autocapture;
- [ ] heatmaps, rage clicks, and dead clicks;
- [ ] exception/error ingestion, grouping, releases, and source maps;
- [ ] browser RUM, Web Vitals, network timing, and manual spans;
- [ ] breadcrumbs correlated with sessions, errors, and replay;
- [ ] feature flags and remote configuration;
- [ ] A/B experiments;
- [ ] alerts and anomaly notifications;
- [ ] webhooks, destinations, and warehouse/object-storage export;
- [ ] shared reports and dashboard collaboration.

Tier 2 ordering is product analytics first: replay after Task 12, then errors
and performance, then flags and experiments. Features may use optional services
or storage components, but their supported self-hosted deployment must ship at
the same time as the hosted capability.

### Tier 3 — nice to have later

- [ ] AI analytics assistant and natural-language queries;
- [ ] automated anomaly/root-cause explanations;
- [ ] predictive churn, conversion, and correlation analysis;
- [ ] surveys, feedback, and in-app messaging;
- [ ] workflow automation;
- [ ] SQL/notebook analytics;
- [ ] visual autocapture event builder;
- [ ] synthetic browser/API monitoring;
- [ ] infrastructure monitoring, full log management, and profiling;
- [ ] plugin/extension marketplace;
- [ ] customer-support inbox connected to profiles and sessions;
- [ ] native Swift, Kotlin, Flutter, Unity, and Unreal SDKs;
- [ ] enterprise SSO, SCIM, advanced audit, and residency controls.

## React Native roadmap constraints

The first React Native release begins only after the web identity and core
insight stages are stable. It must include:

- [ ] `@prism/react-native` backed by `@prism/core`;
- [ ] Expo and bare React Native compatibility;
- [ ] AsyncStorage identity and queue adapter;
- [ ] AppState foreground/background session lifecycle;
- [ ] offline delivery and reconnect flushing;
- [ ] manual `track`, `identify`, `reset`, consent, and global properties;
- [ ] opt-in React Navigation screen tracking;
- [ ] app version/build, OS, and privacy-safe device-class context;
- [ ] no advertising IDs, contact data, or exact location by default;
- [ ] bounded background-transition flush;
- [ ] packed/installed consumer fixtures and a real example application.

Later React Native work may add:

- [ ] JavaScript exceptions and native crash symbolication;
- [ ] startup, screen-render, network, freeze/ANR, and frame performance;
- [ ] privacy-masked native session replay;
- [ ] mobile feature flags and experiments;
- [ ] push/deep-link attribution and OTA release metadata.
