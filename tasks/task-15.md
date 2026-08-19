# Task 15: Build error tracking and crash diagnostics

**Status:** Planned
**Created:** 2026-08-17
**Depends on:** Task 10 identity/privacy semantics, Task 13 source-aware keys,
and Task 14's first live React telemetry proof
**Scope:** An opt-in, source-aware error-tracking product from ingestion and
SDKs through dashboard issue workflows. Generic application logs, replay, and
performance tracing are planned separately.

## Goal

Give a Prism user a trustworthy answer to four questions:

1. What errors are occurring in this project?
2. Which errors are new, regressing, or affecting people now?
3. What stack/context is safe and useful for fixing one error?
4. Has the issue been resolved, ignored, or reopened?

The first complete vertical slice is a React web application: an explicit
exception capture, an opt-in browser global error, and a React render error
appear as grouped issues in Prism. An authorized user can inspect sanitized
occurrences and change issue state. Server capture, source maps, performance,
and arbitrary logs follow as deliberate phases, not as fake product links.

The first implementation and deployment target is the hosted Prism platform
validated by Task 14. The design must preserve Prism's self-hosted architecture,
but self-hosted error-tracking deployment certification is a later release
gate, not an alternative first path.

## Product boundary

`Error tracking` and `crash logs` here mean structured exception occurrences
and grouped issues. They do **not** mean an unbounded general-purpose logging
system.

| Capability | Included in this task | Deliberately separate/future |
| --- | --- | --- |
| Browser/React exceptions | Yes, first vertical slice | Automatic application instrumentation without user opt-in |
| Server exceptions | Contract and later adapter phase | Process ownership/restart policy or infrastructure logs |
| Issue grouping and workflow | Yes | AI diagnosis, alert-routing integrations, or ticket sync |
| Stack traces | Yes, bounded and sanitized | Source-map upload/processing begins only after raw-stack MVP works |
| Breadcrumbs | Bounded, explicitly configured safe breadcrumbs | Full session replay, network-body capture, console capture by default |
| Performance | No | Traces, spans, profiles, Web Vitals/APM |
| Logs | No | Separate structured log ingestion, storage, search, and retention product |

Do not add `captureException`, a React error boundary, an `Errors` sidebar link,
or a dashboard metric until this task has the corresponding ingestion, storage,
authorization, and UI path. A method that only writes a normal analytics event
is not error tracking.

## Architecture decisions to freeze

### 1. Error events use a separate versioned API

Analytics v2 has a mature event/identity contract. Error payloads have
different privacy, grouping, payload-size, retention, and query requirements.
They must not be smuggled into a regular `track()` event or mutate the v2 wire
envelope opportunistically.

```text
Browser / React / future server adapter
  -> POST /api/v1/errors/ingest (bounded error batch)
  -> analytics API authenticates the source key
  -> derives source_id, project_id, platform, and key class
  -> validates, sanitizes, fingerprints, groups, and stores occurrences
  -> authorized product API/read API exposes issues and occurrences
  -> web dashboard renders and manages them
```

- The endpoint name/version above is the proposed public boundary. Freeze it
  with the request/response schema before implementation.
- It uses Task 13's existing source-key authentication and source lookup. The
  client never sends authoritative workspace, project, source, platform, or
  key-type identifiers.
- A Web source applies the same exact allowed-origin policy as analytics
  ingestion. A server source requires its secret source key.
- The service returns per-occurrence accepted/dropped/rejected outcomes without
  leaking project, source, or membership existence to an untrusted caller.
- Error delivery has its own bounded queue/retry policy and must not block,
  reorder, or corrupt the analytics event queue.

### 2. The grouping boundary is project + platform + fingerprint

An issue is a durable group within one project and runtime platform. The same
Web error seen from two Web sources may group together; a browser error must
not silently group with a server/Node error just because text happens to
match.

```text
error_issue unique key = project_id + platform + fingerprint
error_occurrence       = one accepted error event, linked to its issue/source
```

The server computes `fingerprint` from a versioned canonical representation of
the error type, normalized message, and stable top stack frames. The exact
algorithm is an implementation detail, but its version is persisted so future
changes do not silently regroup historical issues. Client-provided fingerprints
may be a constrained hint only; they never bypass server normalization.

Issues have the lifecycle `unresolved`, `resolved`, or `ignored`. A new
occurrence after resolution reopens the issue. An ignored issue remains
searchable and auditable; it does not silently discard future occurrences.

### 3. Extend the existing runtime/adaptor model; do not create a fake SDK

Prism already separates a runtime-neutral Core from browser and React adapters.
Error capture follows the same architecture:

- `@prism-analytics/core` gains the runtime-neutral error payload types, validation,
  sanitization, bounded error delivery lifecycle, and diagnostic seam.
- `@prism-analytics/browser` owns browser-only normalization and explicit global error/
  unhandled-rejection installation.
- `@prism-analytics/react` owns the React error boundary and hooks over a ready browser
  reporter. It never creates a second client/queue during render.
- A future Node package/adapter owns server capture and framework integration.
  It is not bundled into the browser/React release.

The initial directional API, to be validated and frozen before coding, is:

```ts
const analytics = await createBrowserClient({ sourceKey, endpoint, collection });
const errors = createBrowserErrorReporter({
  analytics,
  release: "web@2026.08.17",
  beforeSend(event) {
    return event;
  },
});

errors.captureException(error, { level: "error", tags: { area: "checkout" } });
const uninstall = errors.installGlobalHandlers(); // explicit opt-in

<PrismErrorBoundary reporter={errors} fallback={<RecoveryScreen />}>
  <App />
</PrismErrorBoundary>;
```

This example is a contract sketch, not currently supported code. Before it is
documented, decide and test the public factory names, sync/async behavior,
ownership/cleanup API, and package exports. The reporter may read safe session
and identity context from the ready analytics client, but it must not change
collection consent, identity links, or analytics queue semantics.

### 4. Privacy defaults are stricter than analytics defaults

Error payloads frequently contain accidental secrets. Prism therefore stores
only a bounded, sanitized diagnostic event by default.

- Never collect request/response bodies, authorization headers, cookies, form
  values, local/session storage, full URL query strings, or console output by
  default.
- Redact configured sensitive property names recursively before fingerprinting,
  persistence, logs, or diagnostics. Include a conservative default denylist
  for credentials, tokens, session IDs, passwords, e-mail-like identifiers,
  and payment fields; document its limits rather than claiming perfect PII
  detection.
- Sanitize URL fields to origin + path unless an operator explicitly selects a
  reviewed query allowlist. Remove fragments.
- Bound stack frames, message length, exception chain depth, tags, extras, and
  breadcrumbs. Reject/safely truncate oversized payloads with a diagnostic.
- `beforeSend` can remove or transform a payload, including dropping it. It
  cannot grant consent, bypass sanitization, or attach a secret value after
  validation.
- Error collection follows the existing collection/consent state. A denied or
  withdrawn client does not send browser error data or retain an identity for
  future error reporting.
- Person deletion/export and project deletion must include error associations
  and payloads in their retention/deletion rules. Issue aggregate counts may
  remain only where they cannot identify a deleted person; this policy must be
  made explicit and tested before release.

## Data model and retention plan

Error data belongs in the analytics data store alongside project-scoped
telemetry. Workspace/source configuration and authorization remain in the
product database as they do today.

### Required analytics tables

| Table | Purpose | Required fields/indexes |
| --- | --- | --- |
| `error_issues` | Durable group and workflow state. | ID; `project_id`; platform; versioned fingerprint; status; title/type; first/last seen; occurrence count; first/last release; resolved/ignored metadata. Unique `(project_id, platform, fingerprint_version, fingerprint)` plus project/status/last-seen indexes. |
| `error_occurrences` | One accepted sanitized error event. | ID/client event ID for idempotency; issue ID; `project_id`; `source_id`; platform; occurred/received time; level; handled flag; release/environment/app version; session/person/anonymous references where permitted; normalized exception/frames/tags/extras/breadcrumb JSON. Index project/time, issue/time, source/time, and person/time. |
| `error_issue_activity` | Auditable workflow changes, if the main issue table cannot safely retain a complete history. | Issue ID; actor member ID or system; action; prior/new state; timestamp; bounded comment/reason. |
| `error_source_artifacts` | Future source-map/release artifacts. Do not create it until the upload/retention/auth contract is ready. | Project/source/release/dist/platform; artifact identity/checksum; secure storage reference; processing status; expiry. |

Rules:

- Store client event IDs with a project/source-aware uniqueness constraint so
  retrying an occurrence does not increment issue counts or last-seen time.
- `source_id` is derived by source-key authentication; it is never trusted
  from the payload.
- A single transaction (or equivalent database atomic operation) must insert
  the new occurrence, create/find/update the issue, update counters/last-seen,
  and write workflow activity where relevant. Duplicate delivery has no side
  effects.
- Start with an explicit configurable `ERROR_RETENTION_DAYS`, documented
  separately from event retention. Pruning must be observable and must not
  leave incorrect issue counters or personally identifying orphan records.
- Do not put unbounded JSON blobs in issue rows. Large occurrence context has
  hard limits and retention policy.

## API and authorization plan

### Ingestion contract

- [x] Define a versioned JSON schema for a bounded error batch: client error
      ID, occurred time, level, handled state, normalized exception chain,
      frames, release context, safe tags/extras, and bounded breadcrumbs.
- [x] Define exact per-item response statuses, malformed-item behavior,
      idempotency/conflict behavior, response size limits, and retryable vs
      non-retryable HTTP statuses.
- [x] Reuse the source-key lookup/key status/revocation/origin checks from
      source-aware event ingestion. Do not duplicate a weaker auth middleware.
- [x] Validate source platform compatibility. A browser key may not claim Node
      context; server source behavior must be explicit when its adapter lands.
- [x] Apply rate limits and payload caps per source before expensive parsing,
      fingerprinting, source-map processing, or database work.
- [x] Return safe diagnostics only. Never echo raw payloads, key details, or
      another tenant's existence in an error response.

### Read and workflow APIs

- [x] Add project-scoped, membership-authorized issue list endpoint with
      bounded, stable ordering, a time/range filter, an empty-result contract,
      and windowed counts/delta (state/source/platform/level filters run
      client-side on the list; details/pagination follow the detail view).
      (slice 2: GET /projects/:slug/errors)
- [x] Add issue detail endpoint with summarized occurrence list, sanitized
      exception/frame context, workflow history, and safe aggregate counts.
      (slice 4: GET /projects/:slug/errors/:issueId — windowed issue resource +
      bounded occurrence page with sanitized exception/frames/tag-extras-
      breadcrumb counts, all-time aggregates, release bounds, and
      error_issue_activity workflow history; member-readable, project-scoped)
- [x] Add occurrence detail endpoint only if needed; authorize it through the
      parent issue/project and never use a globally enumerable occurrence ID.
      (slice 4: no occurrence endpoint — summaries arrive inside the issue
      detail; occurrence ids are unguessable random hex only ever reached
      through the authorized (project, issue) parent)
- [x] Add resolve, ignore, and reopen actions with role checks, optimistic
      concurrency or equivalent conflict protection, auditable actor/timestamp,
      and clear reopen-on-new-occurrence behavior.
      (slice 2 + slice 4: PATCH /projects/:slug/errors/:issueId — owner/admin
      only, atomic UPDATE with resolved_by/at + ignored_by/at; slice 4 records
      each transition in error_issue_activity (resolved/ignored/reopened,
      prior -> new, actor, timestamp); reopening clears resolved/ignored
      metadata; reopen-on-new-occurrence driven by slice-1 ingestion)
- [x] Define permission mapping: members may read permitted diagnostic data;
      only owner/admin may change project-wide error workflow/configuration
      unless a later role model deliberately expands that permission.
      (slice 2: enforced server-side via getWorkspaceRole + isAdminRole)
- [ ] Extend project deletion, source deletion/revocation, access removal, and
      export/delete workflows to error data and subscriptions.
- [ ] Do not add alerts, webhooks, Slack/Jira sync, or issue assignment until
      issue state and authorization are stable.

## SDK implementation plan

### Core error capability

- [x] Write the public TypeScript contract and negative validation tests before
      code. It must separate error delivery from normal `track()` delivery.
      (slice 3: error-contract.ts + validating tests first; a SEPARATE lane)
- [x] Add error event ID generation, bounded queueing/batching, idempotency,
      retry classification, shutdown/flush behavior, and diagnostics to the
      runtime-neutral layer.
      (slice 3: error-reporter.ts — own FIFO, client event ids, 1s/2x backoff +
      Retry-After, maxRetries exhaustion, async shutdown drain, coarse diags)
- [x] Ensure error reporting is explicit and opt-in. Core cannot import browser
      globals, React, Node process APIs, or a default hosted endpoint.
      (slice 3: createPrismErrorReporter is called deliberately; injected
      runtime adapter only; no global handlers in core)
- [x] Define safe reporter/analytics-client context sharing: allowed session,
      anonymous/person identity references and global properties are copied only
      after consent and sanitization. The reporter must not revive identity.
      (slice 3: consent-gated share source; anonymousId on the wire, session/user
      report-level only; globals merge into sanitized context.extras)
- [x] Provide a testable `beforeSend` boundary with immutable input/output,
      a drop result, timeout/error behavior, and final server-side sanitization.
      (slice 3: immutable report in/out, drop result, throw→send-original +
      diagnostic; delivery timeouts; the server re-sanitizes)
- [x] Expose diagnostics for dropped, rate-limited, malformed, consent-denied,
      and delivery-failed reports without leaking exception contents into logs.
      (slice 3: error_consent_*, error_queue_full, error_too_large,
      error_batch_rejected, error_rate_limited, error_delivery_failed,
      error_batch_dropped — coarse messages never leak contents)

### Browser adapter

- [x] Normalize `Error`, `ErrorEvent`, and `PromiseRejectionEvent` into the
      frozen payload shape. Handle non-Error rejections safely and consistently.
      (slice 3b normalization in the browser adapter; opaque reasons summarized)
- [x] Implement `captureException` and optional global handlers only after the
      API/storage slice exists. Global handling is off by default and returns
      an uninstall function.
      (slice 3b: captureGlobalErrors opt-in default off; install()/uninstall()
      idempotent — no uninstall FUNCTION but idempotent uninstall())
- [x] Deduplicate a browser global error and an explicit/React-boundary capture
      of the same exception within a documented bounded window without hiding
      genuinely separate failures.
      (slice 3b: dedupeMs default 1s, capped map, coalesces Strict-Mode
      boundary double-captures; window elapse requeues)
- [x] Handle opaque cross-origin `Script error.` events honestly: report only
      safe coarse data or drop with a diagnostic; do not invent a stack.
      (slice 3b: ScriptError type + scriptError extra, zero fabricated frames)
- [ ] Support unload/background delivery within browser constraints without an
      unauthenticated fallback or a secret-bearing request.
- [ ] Test denied consent, revoked keys, wrong origin, malformed payload,
      network failure/retry, unload, and duplicate delivery in a real browser
      environment.

### React adapter

- [x] Add a `PrismErrorBoundary` only after browser reporter behavior is
      stable. It captures render/lifecycle descendant errors plus a sanitized
      React component stack and renders the application's supplied fallback.
      (slice 3b: opt-in class boundary, handled:true, bounded component stack,
      function/static fallback)
- [ ] Do not claim that the boundary catches asynchronous errors or event
      handler errors; document global-handler/explicit capture behavior
      accurately.
- [ ] Ensure Strict Mode does not install duplicate global listeners, report a
      boundary error twice, or create a second reporter/client.
- [ ] Provide a hook/facade only when it has stable ownership and error-state
      semantics. It must throw a helpful error outside the relevant provider.
- [ ] Test component crash, fallback recovery/remount, manual capture, global
      error interaction, consent changes, and teardown with React testing and
      a real consumer fixture.

### Server adapter and source maps, after the browser/React vertical slice

- [ ] Design a Node/server adapter with explicit `captureException` and
      request-context integration. It must not attach global `uncaughtException`
      or `unhandledRejection` handlers by default, because applications own
      crash/restart policy.
- [ ] Add framework integrations only after the base Node adapter has a stable
      lifecycle and flush-on-shutdown contract. Hono is the first candidate
      because Prism already uses it; do not couple the generic package to it.
- [ ] Define releases, distributions, app versions, and environment fields
      consistently across Web, React Native, native mobile, and server sources.
- [ ] Introduce source-map artifact upload using a dedicated deployment/upload
      credential or authenticated management flow, never a browser publishable
      ingest key. Verify checksums, source ownership, size limits, retention,
      access control, and deletion.
- [ ] Display raw but sanitized frames until symbolication is trustworthy.
      Once source maps exist, retain original raw frames for audit and expose
      clearly marked symbolicated frames without leaking source files to
      unauthorized members.

## Dashboard and sidebar plan

Task 14's first live sidebar stays intentionally small. Once this task has a
working end-to-end vertical slice, add one real destination:

```text
PROJECT: <selected project>
  Overview

DATA
  Events
  People
  Live

DIAGNOSE
  Errors

CONFIGURE
  Sources
  Settings
```

Do not add `Performance`, `Replays`, or `Logs` because an error tracker exists.
They are separate data products with their own collection and privacy design.

### Errors list

- [x] Show real project-scoped issues, defaulting to unresolved, with state,
      title/type, severity, source/platform, first/last seen, occurrence count,
      and release when available.
- [ ] Support validated filters for status, source, platform, release, level,
      and date range; use server pagination and preserve filters in the URL.
- [ ] Include loading, empty, error, unauthorized, and no-access states. Do
      not show a fabricated issue or graph as an empty-state illustration.
- [x] Let authorized users resolve, ignore, and reopen with an in-place state
      update and clear confirmation/reason where appropriate.
      (now backed by the slice-2 workflow API with optimistic cache updates
      across range variants)

### Error issue detail

- [ ] Show issue lifecycle, first/last seen, counts, source/platform/release,
      and a trend based only on real occurrences.
      (slice 3c: the route-backed detail Sheet now shows lifecycle delta,
      first/last seen, counts, source/platform/level, and a real-delta trend;
      release and a fuller trend still wait on the issue detail endpoint
      because the list resource carries no release field yet)
- [ ] Show a sanitized exception chain and stack-frame viewer with raw versus
      symbolicated status. Copy actions must copy only the currently visible,
      authorized, sanitized text.
- [ ] Show recent occurrence summaries with safe time/session/person links,
      safe tags/extras, and configured breadcrumbs. Never show secrets,
      cookies, request bodies, or raw auth headers.
- [ ] Show workflow history and resolve/ignore/reopen controls according to
      role. New occurrences after resolution must visibly reopen the issue.
      (slice 3c: resolve/reopen/ignore/stop-ignoring controls ship with an
      owner/admin gate and live cache updates; workflow history and the
      reopen-on-new-occurrence proof still need the detail endpoint)
- [x] Link to an existing person/session/event only when that linkage is
      permitted and available. An issue page must remain useful without it.
      (slice 3c: the Sheet has no person/session links yet and remains fully
      useful standalone; occurrence-level links are deferred until the detail
      endpoint can authorize them)

### Project overview and source settings

- [ ] Add an error-health reading to Project overview only after the Errors
      list/detail is correct: unresolved issue count and errors in selected
      range, with honest loading/empty/error states.
- [ ] Add per-source error collection configuration and status under Sources.
      Make global browser handlers, breadcrumb classes, sampling, and release
      metadata explicit opt-ins with clear privacy explanations.
- [ ] Do not surface a public key, source-map upload secret, or unredacted
      report in overview widgets, screenshots, toasts, or support logs.

## Security, privacy, and operational checklist

- [ ] Perform a dedicated threat-model review covering hostile client payloads,
      source-key theft, XSS through frames/context, multi-tenant issue access,
      stored payload size attacks, source-map access, and deletion/retention.
- [ ] Validate all untrusted payload fields with schema limits before JSON
      parsing/fingerprinting where feasible; use parameterized storage and safe
      JSON rendering that cannot execute payload content.
- [ ] Add CSP-safe code/stack rendering, escaping, redaction tests, and a
      content-security review for the dashboard detail view.
- [ ] Rate-limit ingestion and management actions; cap groups/occurrences per
      source/project as well as batch/payload size.
- [ ] Add retention/pruning jobs with metrics and failure alerts. Pruning must
      be idempotent and safe under concurrent ingestion.
- [ ] Define operational metrics: accepted/dropped/rejected reports, queue
      delay, grouping latency, database failure, source-map processing status,
      storage volume, and retention deletions. Metrics themselves must not
      carry raw exception text or keys.
- [ ] Verify all errors/logs shown to users and operators are non-disclosing.
      A source-key or membership failure must not identify another tenant.
- [ ] Run security review before exposing error capture in a live deployment.

## Phased implementation and acceptance gates

### Phase 0: Contract, threat model, and fixtures

- [ ] Freeze the API/versioning, source authorization, fingerprint version,
      privacy/redaction, lifecycle, retention, and SDK ownership decisions.
- [ ] Create fixture errors that include nested causes, React component stacks,
      non-Error rejection, sensitive-looking values, large payloads, duplicate
      delivery, and cross-origin script errors.
- [ ] Write failing contract and storage tests before implementing each slice.

### Phase 1: Storage and secure ingestion

- [ ] Add migration-owned error schema, idempotent issue/occurrence persistence,
      source-aware auth reuse, grouping, retention configuration, and focused
      real-store tests.
- [ ] Prove one source cannot write/read another project's errors and that a
      duplicate request never advances counts or last-seen state.

### Phase 2: Core and browser error delivery

- [ ] Implement the runtime-neutral reporter and browser adapter with explicit
      capture/global-handler opt-in, consent behavior, queueing, retry, and
      diagnostics.
- [ ] Prove it through packed-package installation in the Task 14 React fixture
      or an equivalent external consumer application.

### Phase 3: React vertical slice and dashboard workflows

- [ ] Implement the React boundary, issue list/detail, authorized state
      actions, source error settings, and honest overview health reading.
      (slice 3c: React boundary, issue list, and the route-backed detail Sheet
      UI are done and live; source error settings and the overview health
      reading remain)
- [ ] In a deployed test environment, cause a controlled React error and prove
      the complete path: source-authenticated occurrence → grouped issue →
      sanitized detail → resolve → automatic reopen on a new occurrence.

### Phase 4: Server support and symbolication

- [ ] Add the explicit Node/server adapter and a focused framework integration.
- [ ] Add secure release/source-map upload and symbolication only after its
      privacy and authorization gates pass.

### Completion criteria

- [x] A user can intentionally capture a React/browser error and opt into
      global browser error collection with a source-specific key.
      (slice 3: createBrowserErrorReporter + captureGlobalErrors +
      PrismErrorBoundary; live e2e proved manual/global/boundary captures
      reach the ingest with the source key)
- [x] The analytics service safely authenticates, sanitizes, idempotently
      stores, fingerprints, and groups occurrences without cross-tenant leaks.
      (slice 1 ingest + live proof: bad-key 401, bad-origin 403, allowed-origin
      200; grouping + retry dedupe proven in flows tests)
- [ ] The dashboard provides a real Errors page and issue lifecycle workflow;
      it does not treat normal analytics events as errors.
- [ ] Consent, source-key revocation, allowed origin checks, retention,
      deletion, and access removal behave correctly for diagnostic data.
- [ ] Packed SDK artifacts and a deployed external consumer prove the browser/
      React path end-to-end; server/source-map support is either complete with
      its own evidence or clearly left in its unchecked phase.
- [ ] No generic Logs/Performance/Replays sidebar entries or SDK promises ship
      before their separate contracts and ingestion paths exist.

## Progress log

Add dated implementation decisions, test evidence, security findings, and
deployment results here. Keep raw keys, stack traces containing sensitive data,
and customer payloads out of this document.

### 2026-08-19 — route-backed issue detail Sheet (slice 3c)

- `/errors/:issueId` is a nested route under the Errors list: the list stays
  mounted and the issue opens in a shadcn Sheet. The URL is the open state, so
  browser back, Escape, or the close button navigate deterministically to the
  list, and a refresh or pasted link keeps the Sheet open.
- Detail data renders from the issue list cache through a reactive
  subscription, so a resolve/reopen/ignore action updates the Sheet in place.
  Rows open on click (`navigate(issue.id)`) or via the title link; the row
  action stops propagation so it never opens the Sheet.
- Shared visual tags (status, level, delta, platform, timestamp) moved to
  `components/errors/issue-visuals.tsx`. The Sheet width was widened beyond the
  default and the open/close transitions sped up (500 ms to 200 ms open,
  300 ms to 150 ms close, overlay matched).
- Verified with `tsc --noEmit`, biome, web vitest 32/32, and `vite build`;
  exercised live against the amber-waffles e2e issue on :5173.
- Scope note: the Sheet renders from the list resource only. Summarized
  occurrences, the sanitized exception/frame viewer, and workflow history still
  await the `GET /errors/:id` detail endpoint (first box under "Read and
  workflow APIs"). Slices 3b-3c browser/React/detail work remains uncommitted;
  the owner holds commits until specified.

### 2026-08-19 — issue detail API + workflow activity (slice 4)

- `GET /projects/:slug/errors/:issueId` (member-readable, project-scoped)
  returns the windowed issue resource plus a bounded page of sanitized
  occurrence summaries (exception type/message, first frames, handled state,
  release/environment, tag-extras-breadcrumb counts), all-time aggregate
  counts + release bounds, and a new workflow-history array. Occurrence ids
  are unguessable random hex reached only through the authorized parent; there
  is no occurrence endpoint, so nothing is globally enumerable.
- New `error_issue_activity` table (migration 010) records user-initiated
  transitions (resolved/ignored/reopened, prior -> new, actor, timestamp).
  `updateIssueStatus` now writes one activity row per real transition; an
  idempotent same-status update writes nothing. Ingestion's system reopen is
  intentionally not duplicated into the user-action log.
- Store reads stay parameterized and project-scoped; the read path derives
  summaries from the already-sanitized persisted payload (never raw client
  input). Test evidence: api errorIssues 18/18, analytics migrations 11/11.
