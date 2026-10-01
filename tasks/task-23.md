# Task 23: Connect telemetry into inspectable journeys

**Status:** Planned; contract design required  
**Created:** September 11, 2026  
**Depends on:** Relevant [Task 22](task-22.md) readiness; Tasks 10, 15, 16,
18, and 20 identity/event/error contracts  
**Scope:** Cross-source correlation, not full distributed tracing or replay

Make it possible to connect a product event to its session, related errors,
and explicitly correlated server work. Build an evidence layer using existing
stores and explicit identifiers before considering a graph database.

## Current gap and boundaries

Read `packages/core/src/error-contract.ts`, the error serializer, and
`apps/analytics-api/src/repositories/ErrorIngestRepository.ts`. The current
contract distinguishes report-level session/user references from the persisted
wire representation. Existing source/release/anonymous attribution is not
enough to claim exact session-level error impact.

Read Task 22's shared implementation instructions. Preserve identity's durable
first-wins behavior; do not infer links from email, IP, geography, or timestamps.
Correlation is not authorization and does not prove causality.

## Slice 1: Freeze a correlation contract

Inventory the existing fields before introducing new identifiers.

- [ ] Map event, error occurrence, person, anonymous identity, session, source,
  and installation identifiers across Core, adapters, wire, and persistence.
- [ ] Define optional session and operation correlation fields, their lengths,
  validation, ownership, lifetime, and SDK availability. Distinguish a local
  session from a request/operation and from a long-lived person.
- [ ] Define which links are exact, identity-resolved, inferred candidates,
  missing, or expired. Only exact/approved identity links support exact counts.
- [ ] Specify event time, receipt time, clock skew, duplicate delivery, and
  deterministic ordering when clocks or session sequences disagree.
- [ ] Define cross-source operation propagation without pretending browser,
  mobile, and server processes share one session lifecycle.
- [ ] Freeze backward compatibility: old SDK payloads remain valid and have
  explicit missing correlation, not fabricated backfilled relationships.

## Slice 2: SDK propagation and error capture

Keep shared behavior in Core and environment-specific integrations in adapters.

- [ ] Carry the consent-permitted session identity into opt-in error reports
  through an explicit compatible wire version/schema change.
- [ ] Expose bounded per-operation context APIs for Node and client adapters.
  Concurrent Node requests must never share mutable actor/session globals.
- [ ] Define explicit opt-in request propagation with a destination allowlist.
  Don't forward identifiers, credentials, or tracing headers to arbitrary URLs.
- [ ] Clear correlation on reset and consent withdrawal; queued records must
  obey existing privacy semantics and must not adopt a later user's identity.
- [ ] Keep mobile family, SDK platform, and operating system separate. React
  Native on iOS/Android and future native SDKs must fit without renaming events.
- [ ] Document manual correlation where automatic integration isn't supported.
  Full span capture, native crashes, and automatic network tracing are excluded.

## Slice 3: Persistence and authoritative linking

Update both ingestion validation and read projections with scoped migrations.

- [ ] Add indexed project/source-scoped correlation fields or relations after
  reviewing actual query shapes. Do not add a graph store without evidence.
- [ ] Resolve identity through the production identity resolver; validate
  referenced sessions and relationships belong to the same authorized project.
- [ ] Treat browser-supplied operation IDs as untrusted labels, never proof of
  actor identity or privileged server action. Record link provenance.
- [ ] Handle errors arriving before events and vice versa, with idempotent
  reconciliation. Bound orphan storage and retries; don't block ingestion.
- [ ] Preserve historical snapshot rules. A link discovered later must not
  silently rewrite an earlier cited answer; version its availability or make
  non-replayable relationship queries explicitly unavailable.
- [ ] Update deletion, source retirement, reset fixtures, retention, and exports
  for every new index/projection. Prevent orphaned sensitive context.

## Slice 4: Journey reads and tools

Use one bounded, authorized read service for dashboard and assistant consumers.

- [ ] Add paginated journey resources with stable item IDs, timestamps, source,
  platform/OS, event labels, related issues, and correlation provenance.
- [ ] Offer session/operation detail and person activity drill-downs without
  downloading a person's entire history or exposing other project memberships.
- [ ] Return coverage counts: correlated, uncorrelated, and unavailable records.
  Define how incomplete ingestion affects journey completion claims.
- [ ] Register bounded tools in the existing assistant registry. Return typed
  timelines and evidence references, not raw unrestricted event payloads.
- [ ] Never label the last received event as an explicit app close or abandonment
  unless the measurement definition supports that interpretation.

## Layout

Extend existing surfaces rather than introduce a competing navigation system.

- **People detail:** add session/operation grouping to the existing activity
  section; keep identity hashes in technical details.
- **Event detail:** show related errors and operation/session links when present.
- **Issue detail:** show linked sessions and outcome-analysis entry points;
  unknown coverage must be visible beside affected-session counts.
- **Assistant:** render a bounded journey widget with source/OS labels,
  timestamps, linked evidence, and a continuation action for more history.

Use the current redesign's detail-sheet patterns, tokens, and typography.
Don't replace those pages or move sidebar sections. Preserve mobile keyboard
access, empty/error states, and text alternatives for timelines.

## Verification and acceptance

Use real ingestion fixtures, including an adversarial cross-project fixture.

- [ ] Prove web signup → correlated server operation → error → retry → success.
- [ ] Prove two concurrent server actors don't contaminate each other.
- [ ] Prove React Native iOS/Android context remains distinct under one SDK.
- [ ] Test old payloads, spoofed IDs, late links, reset, withdrawn consent,
  duplicates, deleted people, and archived sources.
- [ ] Assert dashboard journey rows and assistant evidence use identical reads.
- [ ] Record focused SDK/store/controller/UI evidence and the approved hosted
  correlation proof, separately from future native-platform support.

## Handoff

Record schema versions, supported correlation paths, and unresolved coverage
here. Tasks 24, 26, and 27 consume these contracts; none may replace missing
correlation with a timestamp-only causal assertion.
