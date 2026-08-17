# Task 9 — Slice 3 and Slice 4 review corrections

## Purpose

This document records the review of:

- `3a4c6e2` — Task 9 Slice 3 correction round;
- `967494e` — Task 9 Slice 4 ingestion implementation.

The reviewed implementation has strong unit coverage and establishes useful
v2 primitives, but Slice 4 is not complete yet. The remaining problems cross
the SDK transport contract, privacy identity, hosted/self-hosted routing,
untrusted input handling, delivery semantics, and database failure behavior.

Complete this correction slice before starting Slice 5 storage migrations.
Several corrections affect the public contract or persisted queue format; it
is cheaper and safer to settle them before that contract is used by browser,
React, Vue, React Native, or Node adapters.

There are no production users and no analytics data that must be preserved.
Do not retain compatibility code for malformed or pre-v2 queue snapshots just
to protect disposable test data.

## Review baseline

The following gates were reproduced during review:

- `@prism-analytics/core`: 81 tests passed when run with an isolated npm cache;
- `prism-analytics-api`: 74 tests passed and 3 environment-dependent
  integration tests were skipped;
- core and analytics API builds passed;
- the default core coverage command initially failed because its clean-install
  test inherited a root-owned `~/.npm` cache.

Passing package-level tests did not exercise the complete route from a real
core client, through the public self-hosted proxy, through API-key
authentication, to stored analytics data. A correction-level integration test
for that journey is mandatory.

## Required execution order

1. Fix the transport/authentication contract.
2. Fix persistent anonymous identity.
3. Align SDK and server validation/limits.
4. Validate and sanitize event context.
5. Enforce request limits before buffering the body.
6. Make database persistence atomic.
7. Fix public self-hosted routing.
8. Close the remaining delivery and queue correctness gaps from Slice 3.
9. Harden rate-limiting identity and weighted accounting.
10. Add the complete SDK-to-storage integration test and rerun all gates.

Do not hide these corrections inside Slice 5. Keep them as a distinct review
correction commit or small set of focused correction commits so the behavior
changes remain auditable.

---

## Release-blocking findings

### 1. The core client cannot authenticate with the v2 ingestion endpoint

**Severity:** Critical — end-to-end functionality

**Current behavior**

- `PrismRequest` contains `body`, `timeoutMs`, and `signal`, but no headers.
- `CoreClient.deliver()` posts the envelope without the project key.
- `POST /api/v2/ingest` is behind `AnalyticsMiddleware`, which requires an
  `Authorization: Bearer <project-key>` header.
- The Node example in `tasks/task-9.md` passes the `PrismRequest` object itself
  to `fetch` as the request body and supplies no authentication header.

The future browser adapter could close over a project key when it constructs a
transport, but the current core contract does not express that requirement.
Direct `@prism-analytics/core` usage—already documented as the future Node/service
surface—cannot implement the contract correctly from the example or types.

**Required fix**

Make authentication an explicit part of the runtime-neutral transport request:

```ts
export interface PrismRequest {
  readonly body: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  readonly signal: PrismSignal;
}
```

The core delivery layer should construct at least:

```ts
{
  "authorization": `Bearer ${projectKey}`,
  "content-type": "application/json",
}
```

Runtime adapters should forward these headers unchanged. They may add
runtime-specific safe headers, but must not remove or log authentication data.
The project key must never appear in diagnostics, thrown messages, server
responses, or debug logs.

Keep the project key owned by the core client configuration. Do not require
every framework adapter to independently recreate Prism authentication
semantics; that would produce divergent browser, React Native, and Node SDKs.

Update all transport fakes, adapters, examples, and JSDoc in the same change.
The Node example must pass `request.body`, `request.headers`, and
`request.signal` to `fetch`.

**Tests required**

- Type-level test proving every `PrismTransport` receives immutable headers.
- Core delivery test asserting the correct authorization and content-type
  headers are supplied.
- Test proving diagnostics and error objects never contain the project key.
- API integration test: missing, malformed, and wrong bearer keys return 401.
- Complete integration test: a real core client authenticates successfully
  against the real v2 route.

**Done when**

- A consumer can copy the documented Node example and ingest successfully.
- Browser/React Native/Node transports only translate the transport request;
  they do not implement Prism-specific authentication logic.
- Authentication failure remains a permanent 401 delivery rejection without
  leaking the key.

**Primary code areas**

- `packages/core/src/contract.ts`
- `packages/core/src/core.ts`
- `packages/core/src/__tests__/`
- `apps/analytics-api/src/middlewares/AnalyticsMiddleware.ts`
- `tasks/task-9.md`

---

### 2. Persistent anonymous IDs are stored but never attached to events

**Severity:** High — identity correctness and privacy semantics

**Current behavior**

`ensureAnonymousIdentity()` reads or creates the persistent ID, but does not
assign it to the field used by `buildEvent()`. Only session-scoped identity is
assigned. Consequently, persistent storage can contain an anonymous ID while
every delivered envelope omits `anonymousId`.

This was reproduced during review with an existing stored ID: storage retained
the ID and the wire event had no anonymous ID.

**Required fix**

- Replace the misleading `sessionAnonymousId` state name with a scope-neutral
  in-memory field such as `anonymousId`.
- For persistent mode:
  1. read the existing value;
  2. validate its shape and size;
  3. use it when valid;
  4. otherwise generate a new ID, persist it, and assign the same value to the
     in-memory field.
- If persistence fails, retain the generated value only for the current client
  lifetime and emit a coarse diagnostic. Do not repeatedly generate a new ID
  for every event.
- On consent withdrawal, abort delivery, purge queued events, remove the
  persisted ID, clear the in-memory ID, and close the current session.
- On later re-grant, generate a fresh context. Never silently restore the
  pre-withdrawal identity.

**Tests required**

- Existing persistent ID appears on every event after factory resolution.
- Newly generated ID is both stored and attached to the first event.
- A storage-write failure produces one stable in-memory ID plus a redacted
  diagnostic.
- Consent withdrawal removes both stored and in-memory identity.
- Re-grant creates a different anonymous ID.
- Session-scoped identity remains stable only for the client lifetime.
- `anonymousPersistence: "none"` never reads or writes identity storage.

**Done when**

The collection-state and identity behavior form one consistent state machine:
no identity before consent, one stable ID while granted, and no reuse after
withdrawal.

**Primary code areas**

- `packages/core/src/core.ts`
- `packages/core/src/__tests__/contract.test.ts`
- `packages/core/src/__tests__/core.test.ts`

---

### 3. SDK configuration can produce envelopes the server must reject

**Severity:** High — public contract and permanent data loss

**Current behavior**

- Core and server share default constants, but core queue options may be set
  above the server's fixed limits.
- A core client configured with `maxBatchEvents: 100` transmitted 51 events in
  one request even though the server accepts at most 50.
- Core event-name validation checks only emptiness and length. It accepts
  control characters that server validation rejects.
- Runtime value validation permits values such as non-finite numbers, dates,
  and class instances to be silently transformed by `JSON.stringify` rather
  than rejecting them as non-JSON inputs.

An official SDK event can therefore return `queued`, reach the server, receive
a permanent `rejected` result, and be removed. That violates the shared
contract and creates invisible event loss.

**Required fix**

- Treat `INGEST_LIMITS` as hard protocol ceilings, not merely defaults.
- At factory creation, reject queue settings above the wire ceilings with a
  specific configuration error naming the invalid value and maximum.
- Lower values remain valid for consumers that want smaller batches.
- Enforce matching event-name rules in one shared validator used by core and
  server, including control-character rejection.
- Validate values as strict JSON before sanitization:
  - allow null, booleans, finite numbers, strings, arrays, and plain objects;
  - reject `undefined`, functions, symbols, bigint, non-finite numbers,
    `Date`, class instances, accessors, and dangerous keys;
  - enforce shared depth, string, array-length, object-key-count, event-size,
    and batch-size limits.
- Avoid relying on `JSON.stringify()` as the validator. Serialization can
  silently convert or discard unsupported JavaScript values.
- Export one runtime-neutral validation/sanitization implementation from the
  core package for server reuse. Server-side validation remains mandatory
  because direct HTTP callers are untrusted.

**Tests required**

- Factory rejects every queue ceiling above `INGEST_LIMITS`.
- Lower custom limits still work.
- Exactly 50 events are accepted; 51 cannot be emitted in one SDK batch.
- Core and server share a table-driven corpus of valid and invalid names.
- Table-driven property tests cover non-finite numbers, dates, class
  instances, accessors, dangerous keys, excessive keys/arrays/depth, Unicode
  byte size, and cyclic structures.
- Every event accepted by the core validator is accepted by server validation.
  Add this as a contract parity test, not duplicated hand-picked assertions.

**Done when**

For the same protocol version, the official SDK cannot construct a batch or
event that the server rejects for size, shape, name, timestamp, or property
rules.

**Primary code areas**

- `packages/core/src/limits.ts`
- `packages/core/src/validation.ts`
- `packages/core/src/contract.ts`
- `packages/core/src/core.ts`
- `apps/analytics-api/src/utils/ingestValidation.ts`

---

### 4. Event context bypasses validation and sanitization

**Severity:** High — sensitive-data exposure and availability

**Current behavior**

The ingestion service applies the shared sanitizer only to `properties`.
`context` is accepted as a record of unknown values and written with
`JSON.stringify()` without equivalent validation or redaction.

Consequences:

- a direct HTTP caller can store passwords, authorization tokens, API keys, or
  other denied fields inside context;
- dangerous keys and non-JSON values do not receive the same policy as event
  properties;
- deeply nested context can overflow the JavaScript call stack. A 12,000-level
  context produced `RangeError: Maximum call stack size exceeded` during
  review.

**Required fix**

- Define a typed v2 context contract instead of accepting an unrestricted
  `Record<string, unknown>` forever. It should support runtime-neutral fields
  needed by browser, React Native, and Node without importing those runtimes.
- Apply the same strict JSON, dangerous-key, depth, string, array, key-count,
  and byte limits to both properties and context.
- Apply credential-key redaction at every level of both objects.
- Implement boundary traversal iteratively with an explicit work stack or
  otherwise guarantee malformed depth cannot cause a native call-stack
  overflow before a controlled validation error is returned.
- Treat the batch-level `sdk` object as authoritative. Direct clients must not
  override trusted project ownership or server-generated fields through
  context.
- Return only coarse rejection reasons. Never echo context keys or values in
  API responses or diagnostics.

**Tests required**

- Credentials nested in context objects and arrays are redacted.
- Prototype-pollution keys are rejected at every depth.
- Extremely deep context returns a controlled event-level rejection and never
  throws a `RangeError` or produces a 500.
- Context byte/key/array/string ceilings match the SDK.
- Direct HTTP and official SDK events produce equivalent stored context.
- Rejection responses contain no submitted keys or values.

**Done when**

No user-controlled JSON field can bypass Prism's validation, privacy,
redaction, or resource ceilings by moving from `properties` to `context`.

**Primary code areas**

- `packages/core/src/contract.ts`
- `packages/core/src/validation.ts`
- `packages/core/src/core.ts`
- `apps/analytics-api/src/utils/ingestValidation.ts`
- `apps/analytics-api/src/controllers/IngestController.ts`

---

### 5. Body-size enforcement happens after unbounded buffering

**Severity:** High — denial of service

**Current behavior**

The API rejects an honest oversized `Content-Length`, but requests without a
length—or with a false length—are fully materialized by `ctx.req.text()` before
the actual UTF-8 length is checked. Chunked or streamed clients can therefore
force allocation of an arbitrarily large request body.

**Required fix**

- Enforce `INGEST_LIMITS.maxBatchBytes` while reading the request stream, not
  after converting the entire body into a string.
- Use a runtime-compatible body-limit middleware if it demonstrably stops
  reading at the limit in both Cloudflare Workers and Node. Otherwise add a
  small bounded reader that counts bytes and cancels the stream immediately
  after the limit.
- Keep the `Content-Length` precheck as an inexpensive early rejection, but do
  not trust it as the enforcement mechanism.
- Return the same coarse 413 response for declared and streamed oversize
  requests.
- Do not log or include partial request bodies in errors.

**Tests required**

- Oversized declared `Content-Length` is rejected before reading.
- Oversized stream with no `Content-Length` is stopped at the limit and returns
  413.
- Falsely small `Content-Length` cannot bypass the byte limit.
- A payload exactly at the ceiling follows normal JSON validation.
- Multibyte UTF-8 input is counted in bytes, not UTF-16 code units.
- Tests cover the Node entry point and Worker-compatible request path.

**Done when**

No request path allocates or parses more than the configured ingestion body
ceiling, regardless of client-supplied headers.

**Primary code areas**

- `apps/analytics-api/src/controllers/IngestController.ts`
- analytics route/middleware registration
- analytics controller integration tests

---

### 6. A database error can partially persist a batch

**Severity:** High — batch consistency and retry behavior

**Current behavior**

Validated events are inserted serially without a transaction. If insert `N`
fails after earlier inserts succeed, the request becomes a 500 after partial
persistence. The client receives no per-event result and retries the whole
batch. Idempotency protects already-inserted rows on replay, but a repeated
database failure can indefinitely block later valid events and makes the
response contract nondeterministic.

**Required fix**

- Parse, validate, and sanitize the complete batch before starting writes.
- Separate rejected validation results from the valid insert set.
- Persist all valid events in one database transaction or one atomic Turso
  batch operation.
- If persistence fails, roll back all writes from that request and return a
  coarse retryable 503. Do not return accepted results for rows that were
  rolled back.
- Preserve `(project_id, event_id)` conflict handling so a committed replay is
  reported as `duplicate`.
- Do not classify unknown database failures as permanent event rejections.
- Encapsulate batch persistence behind a focused repository/service boundary
  so controller logic does not own transaction details.

**Tests required**

- Inject failure on a middle insert and assert zero rows from the attempted
  transaction remain.
- Retry after the injected failure accepts the valid events once.
- Duplicate replay returns duplicate without adding rows.
- Validation-rejected events do not enter the transaction.
- Mixed valid/invalid batches return stable per-event results after a
  successful transaction.
- Database errors return 503 with no SQL, database URL, event content, or stack
  trace in the client response.

**Done when**

Each request has one database outcome: all validated events commit, or none of
them do. Client retry remains safe and deterministic.

**Primary code areas**

- `apps/analytics-api/src/controllers/IngestController.ts`
- analytics database manager/repository layer
- v2 ingestion integration tests

---

### 7. The public self-hosted origin routes v2 ingestion to the wrong service

**Severity:** High — self-hosted functionality

**Current behavior**

The core posts to `<endpoint>/api/v2/ingest`. The self-hosted nginx
configuration proxies only `/api/v1/analytics/` to the analytics container;
the general `/api/` rule sends `/api/v2/ingest` to the product API.

**Required fix**

- Add an exact or narrowly scoped `/api/v2/ingest` proxy rule before the
  general `/api/` product route.
- Preserve the original host/protocol metadata required by the service.
- Do not preserve an attacker-provided first `X-Forwarded-For` hop; see the
  trusted-proxy correction below.
- Keep the browser-facing endpoint as the public instance origin so hosted and
  self-hosted users do not need internal container URLs.
- Remove or clearly deprecate the legacy v1 analytics ingestion proxy after
  confirming no v1 ingestion route remains.

**Tests required**

- Compose smoke test sends a real core event to the public web origin, not the
  analytics container directly.
- The request reaches the analytics service and not the product API.
- Invalid key returns the analytics 401 contract through nginx.
- Valid key stores the event and replay returns duplicate.
- Product `/api/v1/*`, auth, health, and WebSocket routes still reach their
  existing services.

**Done when**

The same documented public endpoint works for hosted and Compose self-hosted
deployments without rebuilding the SDK or exposing the analytics container.

**Primary code areas**

- `apps/web/nginx.conf`
- Compose certification/smoke scripts
- self-hosting networking documentation

---

## Remaining Slice 3 delivery corrections

### 8. Queue thresholds do not trigger delivery

**Severity:** Medium — delivery latency and documented behavior

**Current behavior**

After enqueue, `track()` persists the queue and returns. It does not request a
flush when the configured event or byte threshold is reached. Delivery occurs
only through interval, lifecycle, explicit flush, retry, or shutdown paths,
despite the Task 9 checklist marking threshold flushing complete.

**Required fix**

- Have the queue report whether enqueue reached `maxBatchEvents` or
  `maxBatchBytes`.
- Request an asynchronous flush after the successful queue-persistence step.
- Coalesce threshold, interval, lifecycle, and explicit flush requests through
  the existing single in-flight promise.
- Preserve the synchronous `CaptureResult` API; `track()` should not become an
  unbounded network promise.
- Never flush while consent is pending/denied or after shutdown.
- Ensure persistence ordering cannot restore a stale pre-delivery snapshot
  after a successful delivery removal.

**Tests required**

- `maxBatchEvents: 1` causes one asynchronous transport call after `track()`.
- Byte threshold causes a flush before the event-count threshold.
- Three simultaneous threshold triggers produce one request.
- Pending/denied collection never flushes.
- Failed threshold delivery stays queued and follows normal retry behavior.

**Done when**

The documented count and byte thresholds actually initiate delivery without
creating duplicate requests or weakening consent behavior.

---

### 9. Retry jitter can violate `Retry-After`

**Severity:** Medium — protocol compliance and rate-limit pressure

**Current behavior**

The retry scheduler applies ±20% jitter to a server-provided `Retry-After`.
Negative jitter can schedule a retry before the server's stated minimum. The
current 60-second cap can also cause an early retry when the server asks for a
longer delay.

**Required fix**

- Treat `Retry-After` as a minimum, never merely a jitter base.
- Support both delta-seconds and HTTP-date response forms.
- Apply normal jitter to client-computed exponential backoff.
- When a valid server delay exists, schedule no earlier than that delay. Any
  added jitter must be non-negative.
- Do not cap a valid server instruction to a shorter delay. If the runtime has
  a maximum schedulable interval, reschedule in safe chunks without sending
  early.
- Invalid or past headers should fall back to bounded exponential backoff and
  emit at most a coarse diagnostic.

**Tests required**

- Every deterministic jitter seed schedules at or after Retry-After.
- Delta-seconds and HTTP-date forms work.
- A delay greater than 60 seconds is not shortened to 60 seconds.
- Invalid headers fall back to exponential backoff.
- Cancellation removes pending retry scheduling.

**Done when**

Prism never retries before a valid server-provided minimum.

---

### 10. Persisted queue snapshots are trusted without v2 validation

**Severity:** Medium — corrupted storage and permanent rejection loops

**Current behavior**

Queue restoration validates only the outer version and that entries are
strings. It then copies selected fields from arbitrary parsed JSON and keeps a
defensive pre-envelope fallback. A corrupt-but-valid snapshot or old v1 event
can therefore enter a v2 batch and be permanently rejected by the server.

**Required fix**

- Define an exact persisted queue schema separate from the wire envelope.
- Validate every restored entry using the same v2 event validator and hard
  limits used for newly captured events.
- Verify the outer queue metadata, entry count, byte total, event ID, event
  name, timestamp, and serialized envelope agree.
- Reject unknown fields where they would create ambiguous state.
- Quarantine or remove the entire invalid snapshot and emit one coarse
  diagnostic. Do not partially restore a suspicious snapshot.
- Remove the v1/pre-envelope fallback. There are no production users or queues
  requiring migration.
- Keep restoration gated by granted consent.

**Tests required**

- Valid v2 snapshot restores exactly once.
- Old v1 snapshot is purged rather than transmitted.
- Future version is quarantined.
- Mismatched IDs, invalid names, dangerous keys, excessive sizes, and malformed
  timestamps are purged.
- Denied collection removes storage without parsing or transmitting it.

**Done when**

Only events that satisfy the current local v2 contract can enter the active
queue from durable storage.

---

## Rate-limit and ingress hardening

### 11. A first overweight request bypasses the weighted quota

**Severity:** Medium — quota correctness

**Current behavior**

When a rate-limit key has no existing entry, `RateLimiter.hit()` stores the
provided weight and always returns `allowed: true`. A first request whose
weight exceeds the maximum therefore bypasses the limit.

**Required fix**

- Validate `weight` as a finite positive integer.
- Calculate the proposed count before writing state.
- Reject when the proposed count exceeds the maximum, including a key's first
  request.
- Avoid mutating the existing entry in place; replace it with a new immutable
  value after the decision.
- Define whether rejected weight consumes quota and enforce that decision
  consistently. The recommended behavior is not to consume additional quota
  for a rejected request.

**Tests required**

- First hit with `weight > max` is rejected.
- First hit equal to max is accepted; the next positive hit is rejected.
- Invalid, zero, negative, fractional, NaN, and infinite weights are rejected
  by the API or throw a configuration/programming error before state changes.
- Window reset works after weighted rejection.

**Done when**

No ordering of weighted requests can consume more accepted units than the
configured project quota.

---

### 12. Client IP rate limiting trusts spoofable forwarding headers

**Severity:** Medium — defense-in-depth rate-limit bypass

**Current behavior**

`clientIpFrom()` trusts `CF-Connecting-IP` and the first
`X-Forwarded-For` value unconditionally. The self-hosted nginx configuration
uses `$proxy_add_x_forwarded_for`, which preserves an attacker-supplied first
hop. An attacker can rotate that value to evade the per-IP limiter. The
project-key weighted limiter still provides a second boundary, but the IP
control is not reliable.

**Required fix**

- Trust forwarding headers only when the immediate peer is a configured
  trusted proxy or when the runtime guarantees the header is platform-owned.
- For the bundled nginx path, overwrite client-supplied forwarding identity
  with the actual peer address rather than appending an untrusted chain.
- For direct Node deployments, default to the socket/peer address and make
  proxy trust an explicit operator setting with documented CIDR/proxy-count
  semantics.
- For Cloudflare Workers, use a platform-owned connecting-IP value only after
  verifying Cloudflare overwrites client input in the deployed runtime.
- Do not use IP data for authorization, identity, or persistent analytics.
- Keep IP values out of logs and stored event rows.

**Tests required**

- Direct client-supplied forwarding headers cannot rotate the rate-limit key.
- Trusted proxy mode resolves the expected client hop.
- Untrusted proxy mode uses the peer identity.
- Bundled nginx overwrites a forged inbound `X-Forwarded-For` value.
- No IP appears in stored events or diagnostics.

**Done when**

Per-IP limits derive identity only from a trusted infrastructure boundary and
remain privacy-safe.

---

## Accuracy and test-infrastructure corrections

### 13. SDK identity is duplicated despite the recorded wire decision

**Severity:** Medium — contract drift

**Current behavior**

The batch envelope contains `sdk`, but every event context also receives a
`library` object containing the same SDK identity. This contradicts the
recorded decision that SDK identity lives at batch level and is not repeated
per event.

**Required fix**

- Keep SDK identity in one authoritative batch-level location.
- Remove automatic per-event `context.library` duplication.
- If storage and reporting require SDK name/version per event, the server
  should derive those fields from the validated batch metadata during
  ingestion and store them in explicit schema columns in Slice 5. Do not make
  clients duplicate trusted envelope metadata.
- Prevent user context from overriding batch SDK identity.

**Tests required**

- Wire snapshot shows one SDK identity per batch and none injected into each
  event context.
- Stored SDK metadata is derived from the batch during the Slice 5 migration.
- Submitted context cannot override the SDK identity used for storage.

**Done when**

The implemented envelope matches the ADR/task decision and has one source of
truth for SDK identity.

---

### 14. The clean-install consumer test is not hermetic

**Severity:** Low — developer and CI portability

**Current behavior**

The core clean-install test inherits the operator's default npm cache. During
review it failed on root-owned files in `~/.npm` and passed only after setting
an isolated cache manually.

**Required fix**

- Have the test create and own a temporary npm cache inside its temporary
  fixture directory.
- Pass that cache path explicitly to every npm command spawned by the test.
- Clean up the fixture and cache in a `finally` block.
- Do not depend on or modify the developer's global npm configuration.

**Tests required**

- The clean-install test passes with an intentionally unusable global npm
  cache because it uses its isolated cache.
- Temporary directories are removed on success and failure.

**Done when**

The package-consumer gate depends only on the packed artifact, fixture, and
declared package manager inputs.

---

## Mandatory end-to-end correction test

Package-level tests are necessary but insufficient. Add one test or
certification script that exercises the actual deployed contract:

1. start disposable product API, analytics API, database, and nginx services;
2. create or seed a project and valid project write key;
3. create a real `@prism-analytics/core` client using the public nginx origin;
4. grant collection and capture an event containing safe properties/context;
5. reach the batch threshold or call `flush()`;
6. verify nginx routes the request to analytics;
7. verify the bearer key derives the correct project server-side;
8. verify the event is stored once with its event ID, occurrence time,
   anonymous ID, sanitized properties/context, and batch-derived SDK metadata;
9. replay the same event and verify `duplicate` with no second row;
10. withdraw consent and verify no queued or in-flight event is delivered;
11. send an oversized streamed request and verify 413 without full buffering;
12. tear down all disposable services and volumes.

The script must have the same safety guards used by the Task 6 destructive
drills: disposable project name, disposable volumes, loopback-only resolved
targets, and refusal when hosted Neon or Turso environment variables are
present.

## Final acceptance gates

Before marking this review correction complete:

- [ ] All 14 findings above have regression tests and implementation evidence.
- [ ] The mandatory public-origin end-to-end test passes.
- [ ] Core/server validation parity corpus passes.
- [ ] Core coverage remains at least 80% for statements, branches, functions,
      and lines.
- [ ] Analytics changed-code coverage remains at least 80%.
- [ ] All integration tests run rather than being reported as skipped for the
      correction evidence.
- [ ] Root build, typecheck, lint, tests, and audit gate pass.
- [ ] No project keys, authorization headers, event properties, context
      values, request bodies, or IP addresses appear in logs or diagnostics.
- [ ] Hosted and self-hosted ingestion both use runtime-selected endpoints.
- [ ] Task 9 checklist claims are updated to match verified behavior.
- [ ] Slice 5 begins only after these gates are green.

## Suggested commit breakdown

1. `fix(core): authenticate v2 delivery and restore persistent identity`
2. `fix(analytics): align v2 validation and bound request bodies`
3. `fix(analytics): make batch persistence atomic`
4. `fix(self-hosting): route v2 ingestion and trust proxy identity safely`
5. `fix(core): close threshold retry and persisted-queue gaps`
6. `test(task-9): certify core-to-storage v2 ingestion`
7. `docs(task-9): record slice 3 and 4 correction evidence`

Each commit should remain independently buildable and should add its failing
regression test before the production change that makes it pass.
