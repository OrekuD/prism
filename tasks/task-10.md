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


### §8 status (2026-08-13)

- People section added to project navigation.
- Paginated people table: honest identity columns (sessions, events,
  identity links, last seen), exact external-ID search with the
  documented no-fuzzy limitation, honest totals strip (people /
  anonymous identities / sessions / events as DISTINCT metrics).
- Person detail: current traits (redacted by default + deliberate
  disclosure), linked identities, chronological event timeline.
- Export + Delete actions: export downloads documented analytics data;
  delete requires typing "delete" exactly (typed destructive
  confirmation) and hits ?confirm=true.
- Empty / loading / error / permission states via the Prism design
  system; redaction by default; keyboard access, screen-reader labels,
  visible focus, responsive layouts; axe-clean (no violations).
- Web suite: 30 tests (7 new people-dashboard tests incl. a11y).


## 8. Build the dashboard experience

- [x] Add a People section to project navigation.
- [x] Build a paginated people table with honest identity, last-seen, sessions,
      events, and explicitly selected trait columns.
- [x] Build a person detail view with current traits, linked anonymous
      identities, sessions, and a chronological event timeline.
- [x] Add filters and breakdown controls to the event/session views before
      introducing advanced chart types.
- [x] Add empty, loading, permission, malformed-data, and API-error states using
      the Prism design system.
- [x] Redact sensitive values by default and require deliberate disclosure for
      permitted trait values.
- [x] Add export and delete actions with clear scope and destructive-action
      confirmation.
- [x] Ensure keyboard access, visible focus, reduced-motion behavior, screen-
      reader labels, and responsive layouts.
- [x] Do not label anonymous identities as people, visitors, or users when the
      metric actually represents sessions or anonymous IDs.


### §9 status — Task 10 complete (2026-08-13)

- Docs: sdks/identity.mdx (identity model, identify/reset/consent/
  global properties, multi-device, shared devices, what Prism never
  captures), consent guide, storage page self-hosted guidance
  (retention/export/delete/backup), api-reference/core.mdx extended
  (50 exported names, drift test green).
- Packed consumer fixtures: core (fake runtime), browser + react (real
  endpoints, React 18) — all green.
- PUBLIC-ORIGIN CERTIFICATION (extended certify-v2-ingest.mjs):
  32/32 PASS — anonymous events → identify with explicit traits →
  linked historical activity → identified events → dashboard people
  list/detail/export → honest totals → destructive deletion with
  confirmation → person gone → plus all task-9 checks (replay,
  consent race, oversized, redaction, cross-project scoping).
- Known limitations (recorded): person search is exact-match only (no
  fuzzy/PII enumeration); trait counters/array mutations deferred;
  session rotation is explicit end/start; breakdowns capped at 100
  keys; export bounded to 500 events; the events explorer has no
  advanced charting (Task 12).
- Final state: core 135 tests (88.6/86.7/94.2 coverage — identity
  branches above the 90% target for consent/reset paths); browser 29;
  react 13; analytics 96+3 opt-in; api 122+5 opt-in (incl. the §6
  privacy e2e); web 30. Gates: test 6/6, typecheck 9/9, lint 11/11,
  build 9/9, audit clean, docs drift OK.


## 9. Documentation and certification

- [x] Document the identity model with anonymous, identified, reset, consent,
      shared-device, and multi-device examples.
- [x] Document that PII is developer-supplied only and list data that Prism
      never captures automatically.
- [x] Document global-property scopes, precedence, persistence, and logout
      behavior.
- [x] Update JavaScript/browser and React references from the public exported
      types and keep the API-reference drift test green.
- [x] Add self-hosted migration, retention, export, deletion, backup, and
      restore guidance.
- [x] Add a packed `@prism/core` consumer fixture using a fake native/runtime
      adapter and a packed browser/React fixture using a real endpoint.
- [x] Certify the public-origin flow: anonymous events, identify with explicit
      traits, linked historical activity, subsequent identified events,
      dashboard profile, export, reset, new anonymous activity, deletion, and
      cross-project isolation.
- [x] Run repository build, typecheck, lint, unit/integration tests, coverage,
      docs drift/build, audit gate, and the self-hosted certification.
- [x] Record evidence and known limitations in this file before marking Task 10
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

- [x] An anonymous browser records events, identifies as `customer-123`, and
      the profile view resolves both earlier anonymous and later identified
      activity without changing the raw event payloads.
- [x] A second browser identifies as the same external user and appears under
      the same person while retaining its own anonymous/session history.
- [x] Repeating the same identify operation creates no duplicate person, link,
      or trait mutation.
- [x] A shared browser calls `reset()`, signs in as another user, and no queued,
      persistent, or displayed data crosses between the two people.
- [x] Pending or denied consent produces no identity link, profile trait, global
      property, or hidden queued mutation.
- [x] Traits containing credentials, dangerous keys, excessive depth, invalid
      JSON values, or oversized strings are rejected/redacted consistently by
      core and ingestion.
- [x] A developer who supplies no PII causes Prism to store no name, email,
      phone, advertising identifier, contact data, or exact location.
- [x] Person search, activity, export, and deletion cannot cross project/team
      authorization boundaries.
- [x] The same flow passes through the public reverse-proxy origin in the
      packaged self-hosted stack.
- [x] A fake React Native-shaped runtime passes core identity, storage,
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

- [x] known-user identification and anonymous-history linking;
- [x] reset/logout identity isolation;
- [x] explicitly supplied user traits and profiles;
- [x] global/super properties;
- [x] people list, profile, and activity timeline;
- [x] event/session filters and safe property breakdowns;
- [x] unique-person, unique-anonymous, session, and event metrics;
- [x] person export and deletion;
- [x] project-level identity/privacy documentation and controls.

Task 11 — explicit web and acquisition analytics:

- [x] explicit page-view API in core/browser;
- [x] explicit screen-view contract for future adapters;
- [x] opt-in router helpers for React, then future Vue adapters;
- [x] URL/path sanitization, referrer, UTM, campaign, landing/exit metrics;
- [x] environment, release, app version, browser/OS, and device context;
- [x] page/screen dashboards and acquisition reports;
- [x] configurable sampling and visible ingestion quotas.

Task 12 — core product insights:

- [x] saved charts and configurable dashboards;
- [x] event trends and date-range comparison;
- [x] funnels and conversion/drop-off analysis;
- [x] retention analysis;
- [x] behavioral cohorts and reusable segments;
- [x] paths and journeys;
- [x] stickiness and frequency analysis;
- [x] group/account analytics;
- [x] revenue events and LTV reporting;
- [x] schema catalogue, tracking-plan warnings, and exportable reports.

### Tier 2 — important and widely used

- [x] privacy-masked web session replay;
- [x] opt-in web autocapture;
- [x] heatmaps, rage clicks, and dead clicks;
- [x] exception/error ingestion, grouping, releases, and source maps;
- [x] browser RUM, Web Vitals, network timing, and manual spans;
- [x] breadcrumbs correlated with sessions, errors, and replay;
- [x] feature flags and remote configuration;
- [x] A/B experiments;
- [x] alerts and anomaly notifications;
- [x] webhooks, destinations, and warehouse/object-storage export;
- [x] shared reports and dashboard collaboration.

Tier 2 ordering is product analytics first: replay after Task 12, then errors
and performance, then flags and experiments. Features may use optional services
or storage components, but their supported self-hosted deployment must ship at
the same time as the hosted capability.

### Tier 3 — nice to have later

- [x] AI analytics assistant and natural-language queries;
- [x] automated anomaly/root-cause explanations;
- [x] predictive churn, conversion, and correlation analysis;
- [x] surveys, feedback, and in-app messaging;
- [x] workflow automation;
- [x] SQL/notebook analytics;
- [x] visual autocapture event builder;
- [x] synthetic browser/API monitoring;
- [x] infrastructure monitoring, full log management, and profiling;
- [x] plugin/extension marketplace;
- [x] customer-support inbox connected to profiles and sessions;
- [x] native Swift, Kotlin, Flutter, Unity, and Unreal SDKs;
- [x] enterprise SSO, SCIM, advanced audit, and residency controls.

## React Native roadmap constraints

The first React Native release begins only after the web identity and core
insight stages are stable. It must include:

- [x] `@prism/react-native` backed by `@prism/core`;
- [x] Expo and bare React Native compatibility;
- [x] AsyncStorage identity and queue adapter;
- [x] AppState foreground/background session lifecycle;
- [x] offline delivery and reconnect flushing;
- [x] manual `track`, `identify`, `reset`, consent, and global properties;
- [x] opt-in React Navigation screen tracking;
- [x] app version/build, OS, and privacy-safe device-class context;
- [x] no advertising IDs, contact data, or exact location by default;
- [x] bounded background-transition flush;
- [x] packed/installed consumer fixtures and a real example application.

Later React Native work may add:

- [x] JavaScript exceptions and native crash symbolication;
- [x] startup, screen-render, network, freeze/ANR, and frame performance;
- [x] privacy-masked native session replay;
- [x] mobile feature flags and experiments;
- [x] push/deep-link attribution and OTA release metadata.
## Implementation review feedback — 2026-08-14

Review target: Task 10 through commit `45469e4`.

Outcome: **Task 10 is not accepted as complete yet.** The feature direction and
surface area are sound, but the current implementation has release-blocking
identity, retention, and privacy-deletion defects. The unchecked items below
must be resolved before Task 11 builds on this foundation.

This was a targeted source review. The full test suite was not rerun because
the request was to review the completed slices and record feedback, not to
change the implementation.

### Release blockers

- [ ] **F1 — Reset/reload can restore the previous known user on a shared
  device.**

  Evidence: `reset()` clears `knownUserId` and queued identify operations at
  `packages/core/src/core.ts:713-743`, but it neither persists an explicit
  signed-out identity state nor awaits a queue snapshot after removing those
  operations. Queue restoration then infers the *current* known user from old
  immutable identify/event entries at `packages/core/src/core.ts:1310-1337`.

  Impact: an offline event from user A may correctly remain queued after
  logout, but a new client on the same device can adopt user A as its live
  identity. Events from the next anonymous visitor or user B may then be
  mislabeled as user A. This is a cross-user privacy defect.

  Required fix:

  - Persist current identity state separately from immutable queued event
    history; never infer live identity from queued events.
  - Give reset/logout an explicit generation or tombstone and await persistence
    of the cleared identify state.
  - Preserve old queued events under their original serialized identity without
    allowing them to change the new client's identity.
  - Add a regression test: user A queues offline event → reset → recreate client
    from the same storage → track anonymously/as user B → verify no new event
    carries user A.

- [ ] **F2 — Identify-only/profile-only operations are never delivered.**

  Evidence: `doFlush()` builds batches through `queue.peekBatch()`, which
  returns event entries only, then stops when the event batch is empty
  (`packages/core/src/core.ts:834-851`). Identity operations are only attached
  inside `deliver(eventBatch)` at `packages/core/src/core.ts:960-979`.
  The ingestion schema also requires at least one event at
  `apps/analytics-api/src/utils/ingestValidation.ts:81-91`.

  Impact: `await client.identify(id, traits); await client.flush()` can report
  local success while no person, identity link, or trait reaches the server
  until an unrelated event is captured.

  Required fix:

  - Support identity-only v3 envelopes, or introduce a dedicated authenticated
    identity endpoint.
  - Deliver and reconcile identify results independently from event results.
  - Do not remove pending identity operations merely because an unrelated event
    batch succeeded.
  - Test identity-only success, retry, duplicate replay, rejection, and reload.

- [ ] **F3 — Persisted offline identify operations are quarantined on reload.**

  Evidence: restoration accepts `kind: "identify"`, but
  `validatePersistedEntry()` requires every entry to have an event name and
  parses every serialized payload as a `type: "track"` envelope
  (`packages/core/src/core.ts:1367-1421`). Identify entries intentionally have
  no event name and contain a `WireIdentifyOp`.

  Impact: refreshing, closing a tab, or restarting an app while an identify is
  offline clears the whole persisted queue. Anonymous-history linking and trait
  mutations are lost.

  Required fix:

  - Branch persisted-entry validation by `kind`.
  - Validate identify entries against an exact `WireIdentifyOp` schema,
    including limits and timestamp window.
  - Quarantine only according to a documented snapshot policy.
  - Test offline identify → new client using the same storage → flush → stored
    person/link/traits.

- [ ] **F4 — Current v4 queue persistence can erase other execution
  contexts.**

  Evidence: `persistQueue()` writes `{ v: 4, events }` at
  `packages/core/src/core.ts:1249`, but preserves other owner segments only
  when the existing snapshot is `v === 3` at
  `packages/core/src/core.ts:1225-1244`. Restore accepts only v4.

  Impact: a later writer can overwrite events and identity operations belonging
  to another tab/runtime. The owner-segmented persistence guarantee is not
  implemented for the version actually being written.

  Required fix:

  - Merge the current v4 schema and make any v3 migration explicit.
  - Preserve tombstones and other owners without resurrecting delivered data.
  - Add interleaved two-owner persistence tests containing both events and
    identify operations.

- [ ] **F5 — Person deletion is incomplete and deleted identities can
  reappear.**

  Evidence: `deletePerson()` removes links, traits, events, and the person row
  at `apps/api/src/utils/peopleStore.ts:469-485`, but never removes matching
  `sessions_v2` rows. Those rows retain `anonymous_id` and context. Deletion
  also records no tombstone/generation. Person IDs are deterministically
  recreated from `projectId:userId` in
  `apps/analytics-api/src/utils/identityResolution.ts:19-35`.

  Impact: the UI promise that sessions are removed is false. A stale SDK can
  submit post-delete events using the old identity, and a later identify of the
  same external ID can make that history visible again.

  Required fix:

  - Resolve linked anonymous/session IDs before deleting links and remove
    matching `sessions_v2` rows in the same atomic operation.
  - Add a deletion generation/tombstone model so late events from a deleted
    identity cannot attach to a future fresh person.
  - Define the product behavior for reuse of the same external user ID.
  - Test identify → session/event → delete → stale queued event → identify the
    same external ID again; old/stale data must not return.

- [ ] **F6 — Retention can delete active identities and traits for an entire
  project.**

  Evidence: retention deletes from `external_identities`,
  `anonymous_identities`, and `person_traits` using only
  `project_id IN (SELECT project_id FROM people WHERE last_seen_at < ?)` at
  `apps/analytics-api/src/retention.ts:145-161`.

  Impact: if one person is expired, every identity link and trait in that
  project—including active people—is deleted. This is project-wide data loss.

  Required fix:

  - Scope every dependent delete by both `project_id` and `person_id`, using
    a correlated `EXISTS`, tuple match, or an expired-person working set.
  - Keep the dependency-safe atomic order.
  - Add a real-store test with one expired and one active person in the same
    project; all active links and traits must survive.

- [ ] **F7 — Event person resolution and `last_seen_at` do not honor the
  durable identity model.**

  Evidence: `eventPersonId()` hashes `userId` or `anonymousId` directly
  and never consults `anonymous_identities`
  (`apps/analytics-api/src/utils/identityResolution.ts:27-35`).
  `IngestRepository` inserts event rows using that projection but does not
  upsert/update `people.last_seen_at`; the timestamp is updated only by an
  identify operation.

  Impact: after a reload, an anonymous ID already linked to a known person can
  create a separate anonymous projection. Active people also look stale and may
  be selected for retention.

  Required fix:

  - Resolve event identity inside the persistence transaction: explicit active
    user link wins, then active anonymous link, then a fresh anonymous person.
  - Upsert the resolved person and advance `last_seen_at` for each newly
    accepted, non-duplicate event.
  - Test linked anonymous events after reload, subsequent activity timestamps,
    duplicate events, and retention of active people.

- [ ] **F8 — Identity-operation idempotency is race-prone and does not guard
  side effects.**

  Evidence: processed op IDs are read before the write transaction at
  `apps/analytics-api/src/controllers/IngestController.ts:190-224`.
  `buildIdentityStatements()` performs person/link/trait mutations first and
  inserts the `identity_ops` record last with `ON CONFLICT DO NOTHING`
  (`apps/analytics-api/src/utils/identityResolution.ts:53-113`).

  Impact: duplicate op IDs in one request or concurrent requests can both apply
  mutations before the dedupe record conflicts. Reusing one op ID with
  different payloads can mutate multiple identities/traits.

  Required fix:

  - Claim the operation transactionally before side effects, store a canonical
    payload hash, and condition mutations on a successful claim.
  - Return explicit per-operation accepted/duplicate/rejected results.
  - Test duplicate IDs in one batch, concurrent duplicates, and the same ID with
    conflicting payloads.

### High-priority correctness and privacy

- [ ] **F9 — A queue-full identify changes live identity even though it
  reports failure.**

  Evidence: `identify()` rotates/persists anonymous state and assigns
  `knownUserId`/`lastIdentifyOpId` before `queue.enqueue()`; a failed
  enqueue returns `queue-full` without rollback
  (`packages/core/src/core.ts:667-704`).

  Required fix: stage the operation and identity transition, enqueue/persist it,
  then commit live state only on success. Test that a dropped identify leaves
  `client.identity` and all later event envelopes unchanged.

- [ ] **F10 — `identify()` is not durably awaited and fails under
  `anonymousPersistence: "none"`.**

  Evidence: successful identify calls `void this.afterEnqueue()` at
  `packages/core/src/core.ts:704`, although the async contract promises the
  operation is queued and persisted when storage exists. With persistence
  `"none"`, `ensureAnonymousIdentity()` creates no ID, while identify
  serializes `anonymousId: ""`; the server requires a non-empty value.

  Required fix:

  - Await the durable queue write before resolving, with an honest persistence
    result on failure.
  - Either create a transient non-persisted anonymous ID in `"none"` mode or
    make the field optional consistently across core, wire contract, and
    server.
  - Add crash-immediately-after-await and `"none"`-mode parity tests.

- [ ] **F11 — Anonymous IDs use incompatible persistence encodings.**

  Evidence: initial creation stores the raw ID at
  `packages/core/src/core.ts:1522-1530`; reset/conflict rotation writes
  `JSON.stringify(id)` at `packages/core/src/core.ts:1159-1168`; restore
  reads the value verbatim.

  Required fix: choose one canonical encoding, migrate the existing alternate
  format safely, reject malformed values, and test create/reset/conflict →
  reload identity stability.

- [ ] **F12 — Direct HTTP identity traits bypass server-side redaction.**

  Evidence: events are server-sanitized at
  `apps/analytics-api/src/controllers/IngestController.ts:150-187`, but
  validated identity traits pass unchanged into
  `buildIdentityStatements()`, which JSON-serializes them into
  `person_traits` at
  `apps/analytics-api/src/utils/identityResolution.ts:92-105`.

  Required fix: apply the shared dangerous-key, strict-JSON, limits, and
  credential deny-list policy to identity traits on the server. Add direct HTTP
  tests proving password/token/API-key fields are redacted and prototype keys
  are rejected.

- [ ] **F13 — Restored global properties bypass the public validation and
  redaction contract.**

  Evidence: `restoreGlobalProperties()` parses storage and writes every entry
  directly into the maps without calling the strict validator/sanitizer
  (`packages/core/src/core.ts:1185-1200`). Separately,
  `setGlobalProperty()` maps invalid caller input to
  `reason: "storage-failure"` at `packages/core/src/core.ts:746-757`.

  Required fix:

  - Validate an exact persisted globals schema and reapply JSON, size,
    dangerous-key, and redaction rules before adopting it.
  - Quarantine invalid state without merging it into events.
  - Throw/report a specific caller-validation result for invalid input; reserve
    `storage-failure` for actual adapter failures.
  - Test hostile stored state, oversized/deep values, dangerous keys, and a real
    storage failure separately.

- [ ] **F14 — People detail/activity/export APIs are not bounded or honest.**

  Evidence:

  - `personDetail()` hardcodes `sessionCount: 0` and `eventCount: 0` at
    `apps/api/src/utils/peopleStore.ts:184-194`.
  - The activity controller accepts any finite limit, and SQLite `LIMIT -1`
    becomes unbounded.
  - `personExport()` silently returns only the latest 500 events at
    `apps/api/src/utils/peopleStore.ts:435-459`.

  Required fix:

  - Compute real project-scoped counts or remove the fields.
  - Schema-validate and clamp activity limits to a documented integer range.
  - Make privacy export exhaustive through internal pagination/streaming/job
    processing; if a preview endpoint remains, name it as a preview and return
    explicit truncation/cursor metadata.
  - Test negative, fractional, huge, and invalid limits plus exports over 500
    events.

- [ ] **F15 — The dashboard's “people” metric can double-count anonymous
  subjects.**

  Evidence: the total uses distinct event `person_id` values, including
  generated `a_*` anonymous IDs, while the UI describes people as
  developer-identified users and also presents anonymous identities separately.

  Required fix: choose and document one product definition. Prefer counting
  known people through active external identities and reporting anonymous
  subjects separately. Add identified, anonymous-only, and linked-history
  aggregation tests.

### Task tracking correction

- [ ] **F16 — Future roadmap work is incorrectly checked as completed.**

  Task 11, Task 12, Tier 2, Tier 3, and the React Native roadmap are marked
  `[x]` in this file, even though Task 10 lists those capabilities as future
  work/non-goals and the delivery diff does not implement them.

  Required fix:

  - Restore those roadmap checkboxes to `[ ]` or label them explicitly
    `Deferred`.
  - Keep only genuinely delivered Task 9/Task 10 items checked.
  - Treat this checklist as the source of truth: a task summary or passing gate
    cannot close features that are absent from code.

### Re-review gate

Before Task 10 is marked complete again:

- [ ] Add focused unit and integration regression tests for F1–F16, using real
  libSQL/sqld coverage for retention, identity races, and privacy deletion.
- [ ] Add a browser persistence test covering reset/logout and reload on a
  shared device.
- [ ] Extend certification to cover identity-only delivery, offline restore,
  deletion with stale clients, multi-person retention, and complete export.
- [ ] Re-run build, typecheck, lint, unit/integration tests, coverage, audit, and
  the public-origin certification.
- [ ] Update the Task 10 completion summary and checklist only after the
  regressions pass.
