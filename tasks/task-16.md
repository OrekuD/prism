# Task 16: Complete source-aware event exploration

**Status:** Planned  
**Created:** 2026-08-21  
**Depends on:** Task 10 identity/privacy semantics and Task 13 source-aware
workspaces, projects, and ingestion keys  
**Supports:** Task 14's hosted React live test and Task 15's source-aware error
diagnostics  
**Scope:** Close the gap between Prism's trusted event ingestion model and the
event, person, session, source, and setup experiences exposed by the product.

## Goal

Make accepted analytics data fully inspectable and correctly attributable in
the hosted Prism dashboard. A user must be able to answer what happened, when
it happened, which person/session it belongs to, and which installed source
sent it without reading raw database rows or confusing client context with
trusted source metadata.

This task also makes the Sources experience honest. Setup instructions must
compile against packages that exist, platform choices must match released
capabilities, source history must survive source retirement, and secret server
keys must not be recoverable from Prism's database after their one-time reveal.

## Why this work exists

The write path is ahead of the read path. Analytics ingestion already derives
`project_id`, `source_id`, and trusted `platform` from the source key and stores
them with each accepted event. It also stores identity, context, and SDK
metadata. The current API and dashboard expose only a small subset of those
fields.

The following inventory is the baseline for implementation and review:

| Area | Current implementation | Gap to close |
| --- | --- | --- |
| Event storage | Stores source, trusted platform, type, identity, properties, context, and SDK fields. | Read resources omit most stored fields. |
| Event list API | Returns the newest 200 events with no cursor. | No stable pagination, source filter, source name, trusted platform, or detail resource. |
| Filtered events | Separate bounded endpoint supports time, name, person, session, and one property filter. | It duplicates the list path and cannot filter by source or trusted platform. |
| Breakdowns | Supports event, person, session, context kind, and context platform. | No source or trusted source-platform dimension. |
| Events page | Shows event name, session, properties, and time. | It cannot explain which installation sent an event or expose the full safe payload. |
| People activity | Reuses the limited event resource. | Person timelines lose source and runtime attribution. |
| Sessions and Live | Session rows persist source and platform. | Public session and live resources omit them. |
| Sources | A project has many sources and each source has rotation-period keys. | Hard deletion destroys source metadata while analytics rows retain its UUID. |
| Setup snippets | Generated from a platform string. | Browser setup omits required consent collection; server and mobile examples reference APIs/packages that do not exist. |
| Origins | API accepts URL values; the UI also accepts wildcard-looking origins. | UI and API validation disagree, and a name-only update can clear origins. |
| SDK metadata | Core writes `@prism-analytics/core` for every analytics batch. | Browser-originated events cannot report their actual delivery adapter. |
| Secret keys | Comments promise one-time reveal. | Secret values are stored in plaintext and can be revealed later. |

## Product and architecture decisions

The decisions in this section are part of the task contract. They must be
implemented consistently in types, APIs, storage, UI copy, tests, and docs.

### 1. A source is the durable attribution boundary

Events are attributed to a source, not to the individual key used during a
rotation window.

```text
Workspace
  -> Project: Acme production
       -> Source: Acme React web
            -> current publishable key
            -> temporary rotation key
       -> Source: Acme API
            -> current secret key
```

- The analytics service must continue deriving project, source, trusted
  platform, and key class from the presented ingestion key.
- Client payloads must not supply or override those authoritative values.
- Multiple active keys under one source remain a rotation mechanism. Prism
  must not add a key ID to event resources or claim key-level analytics.
- Events sent with either rotation key appear under the same source.
- Project remains the cross-source analytics boundary. A product's web,
  mobile, and server activity can be analyzed together when those producers
  intentionally belong to the same project/environment.

### 2. Trusted platform and runtime context are different fields

The UI and API must use distinct names for two different concepts:

| Value | Authority | Example | Product label |
| --- | --- | --- | --- |
| Source platform | Derived from the source key | `web`, `server` | `Source platform` |
| Runtime context | Reported by the SDK in bounded context | `browser`, `node` | `Runtime` |

`context.platform` must not be presented as the trusted source platform. The
existing `context-platform` breakdown may remain for compatibility during the
pre-launch refactor, but its API type, dashboard label, and documentation must
make the runtime meaning explicit.

### 3. React is a Web source with a React setup recipe

React does not become a separate trusted platform. A React application creates
a source with platform `web`, gives it a useful installation name such as
`Acme React web`, and selects the React setup recipe in that source.

- JavaScript and React are local setup views for a Web source.
- `@prism-analytics/react` remains a thin integration over one ready Browser
  client. It must not create a second runtime, session, queue, or event stream.
- Browser-delivered analytics reports the Browser SDK identity. The source
  name is what differentiates one React/Web installation from another.
- Direct Core usage reports Core. A future Node analytics factory reports
  Node. Package identity must never be inferred from arbitrary event
  properties.

### 4. Use one canonical event list and one event detail contract

The pre-launch API may make a clean break. Replace the separate basic and
`filtered` listings with one project-scoped list endpoint that accepts bounded
filters and cursor pagination. Add a project-scoped event detail endpoint for
the complete authorized view.

The shared types should follow this shape direction:

```ts
type EventSourceAttribution = {
  id: string;
  name: string;
  platform: "web" | "ios" | "android" | "react-native" | "server";
  status: "active" | "archived";
};

type EventListItemResource = {
  id: string;
  projectId: string;
  name: string;
  type: string;
  occurredAt: number;
  receivedAt: number;
  personId: string | null;
  sessionId: string | null;
  source: EventSourceAttribution;
};

type EventDetailResource = EventListItemResource & {
  anonymousId: string | null;
  userId: string | null;
  properties: Record<string, unknown> | null;
  context: Record<string, unknown> | null;
  sdk: { name: string; version: string } | null;
  schemaVersion: number;
};

type EventsListResource = {
  events: EventListItemResource[];
  nextCursor: string | null;
};
```

The implementation may refine names during review, but it must preserve the
list/detail separation, typed source attribution, nullable historical fields,
and opaque keyset cursor.

### 5. Source retirement preserves analytics attribution

Deleting a source must become a terminal archive operation rather than a hard
delete of its metadata.

- Archiving a source must atomically mark it archived and revoke all active
  keys so it cannot accept new analytics or error telemetry.
- Historical analytics rows and the source's name/platform metadata must
  remain available for authorized event, person, and session reads.
- Active source lists hide archived sources by default. Historical event
  filters may include them and label them `Archived`.
- Project deletion remains a true project-data deletion boundary and must
  remove the project's analytics according to the existing privacy contract.
- Task 15's source-error deletion policy remains valid: archiving a source may
  purge its error occurrences while retaining the minimum source metadata
  needed to explain historical analytics.
- The first version does not need source restoration. The UI must explain that
  archiving revokes its keys and is irreversible.

### 6. Source creation reflects installable capabilities

The source platform vocabulary may reserve future platforms, but users must
not receive setup instructions for packages that do not exist.

| Source choice | Current supported capability | Required setup behavior |
| --- | --- | --- |
| Web | Analytics and browser/React errors | Show JavaScript and React recipes using Browser + React packages. |
| Server | Node error reporting only | Show only the implemented Node error setup until a Node analytics factory exists. |
| React Native | Not released | Do not offer creation or emit an install command yet. |
| iOS | Not released | Do not offer creation or emit an install command yet. |
| Android | Not released | Do not offer creation or emit an install command yet. |

The API must enforce the same availability policy as the web application. A
future SDK release changes one capability registry and its tests; it must not
require inventing a second source model.

### 7. Secret keys are one-time values

Publishable keys are identifiers intended for client bundles. Secret server
keys are credentials and must be handled differently.

- Secret source keys must be shown only in their creation response.
- Store a lookup digest plus safe display metadata for a secret key, not its
  recoverable plaintext value.
- Remove the secret reveal route and UI. Rotation is the recovery path for a
  lost secret.
- Publishable keys may remain retrievable because they are not secrets, but
  they remain write-only credentials with no dashboard read authority.
- Key comparisons must use a safe digest lookup and must preserve revocation,
  allowed-origin, rate-limit, last-used, and source authorization behavior.
- Because Prism has not launched, use a reviewed destructive migration instead
  of carrying two permanent secret-key storage formats.

## Required implementation work

The checklist is ordered so storage and shared contracts lead the UI. The
implementation agent must use focused tests while iterating and avoid running
unrelated workspaces merely to produce a larger evidence list.

### 1. Freeze shared event and source contracts

This slice defines the vocabulary used by every later change.

- [ ] Add typed source attribution and separate list/detail/list-envelope
      resources to `@prism-analytics/types`.
- [ ] Add a typed event filter request covering `from`, `to`, event name,
      source ID, trusted source platform, person ID, session ID, bounded exact
      property matching, cursor, and limit.
- [ ] Define one cursor codec for `(received_at, id)`. Invalid, expired, or
      mismatched cursors must return a safe validation error rather than
      silently restarting at page one.
- [ ] Update session and live resource types with origin source attribution.
      Define this as the source that emitted `session_started`; do not imply
      that it lists every source that later referenced the session ID.
- [ ] Keep identity values nullable and preserve decoded JSON values at the API
      boundary. Do not return JSON strings for the dashboard to parse.
- [ ] Remove or migrate the old broad `EventResource` only after every API and
      web consumer uses the correct list or detail resource.

### 2. Preserve source history and secure source keys

This slice fixes lifecycle and credential behavior before event reads depend
on source metadata.

- [ ] Add reviewed pre-launch migrations for source archive state and secret
      key digest/display metadata. Remove recoverable secret-key storage.
- [ ] Replace source hard deletion with an authorized archive transaction that
      revokes active keys and cannot leave a usable ingestion credential.
- [ ] Keep archived source rows available to project-scoped attribution reads
      while excluding them from the default active setup list.
- [ ] Remove secret-key reveal from the router, controller, client mutations,
      and UI. Keep publishable-key retrieval explicit and correctly labelled.
- [ ] Prove archive, project deletion, membership removal, and key revocation
      still invalidate ingestion and live access without crossing tenant
      boundaries.
- [ ] Reconcile Task 15's source-error purge with source archiving and retain
      no orphan error issue, occurrence, workflow, or source-setting rows.

### 3. Make source configuration and setup truthful

This slice eliminates setup instructions that cannot work as copied.

- [ ] Introduce one shared source capability policy used by API validation,
      source creation UI, setup views, and tests.
- [ ] For a Web source, provide working JavaScript and React recipes using
      `createBrowserClient`, explicit `collection`, one ready client, and the
      React provider lifecycle from Task 14.
- [ ] Remove nonexistent React Native, iOS, and Android install commands and
      prevent creation of those unavailable source types until their packages
      exist.
- [ ] Replace the invalid server analytics snippet with the implemented Node
      error-reporter setup. Do not show `track()` for Node until a real Node
      analytics factory is exported and package-tested.
- [ ] Ensure every copied example uses synchronous `track()` correctly and
      awaits only asynchronous lifecycle operations such as `flush()` or
      `shutdown()`.
- [ ] Use one exact-origin validator on client and server. Accept canonical
      HTTP(S) origins only; reject paths, credentials, queries, fragments, and
      wildcard origins in this initial policy.
- [ ] Preserve a Web source's existing `allowedOrigins` when an update omits
      the field. An explicit empty array is the only way to clear it.
- [ ] Add positive and negative tests for localhost HTTP, hosted HTTPS,
      canonicalization, invalid protocols, wildcard input, and name-only
      updates.

### 4. Report accurate analytics SDK metadata

This slice makes stored SDK name/version useful without weakening the trusted
source boundary.

- [ ] Add an internal immutable SDK descriptor seam to Core. Direct Core usage
      defaults to Core; adapters supply their own package name/version.
- [ ] Make Browser analytics batches report `@prism-analytics/browser` and its
      package version without accepting an application-controlled SDK name.
- [ ] Keep React on the ready Browser client and document that event delivery
      reports Browser while the source name identifies the React installation.
- [ ] Prove a caller cannot override source, trusted platform, key class, or SDK
      descriptor through event properties or context.
- [ ] Add contract tests for Core and Browser batch metadata and confirm error
      reporter metadata remains correct after the shared change.

### 5. Build the canonical event read API

This slice turns the stored event model into an authorized, bounded product
contract.

- [ ] Replace the basic and `filtered` event listings with one authorized
      `GET /projects/:slug/events` path using the shared filters and cursor.
- [ ] Add authorized `GET /projects/:slug/events/:eventId` detail lookup scoped
      by both project ID and event ID. Cross-project and non-member lookups must
      use the existing non-disclosing response policy.
- [ ] Select the stored `type`, source, trusted platform, identity, context,
      SDK, and schema fields required by the appropriate resource rather than
      reconstructing them from properties.
- [ ] Batch-hydrate distinct source IDs from Postgres once per response. Do not
      perform one source query per event.
- [ ] Return retained archived source metadata. Treat a missing source row as a
      detectable integrity fault with safe user-facing fallback, not as proof
      that the client omitted source information.
- [ ] Use stable newest-first keyset pagination over `(received_at, id)` and
      add the indexes/query-plan evidence needed for project, source, platform,
      person, and session filters.
- [ ] Keep limits bounded and validate property paths/values. Do not interpolate
      untrusted identifiers or JSON paths into SQL.
- [ ] Extend breakdowns with `source` and `source-platform`. Rename or clearly
      label `context-platform` as runtime platform.
- [ ] Cover empty pages, equal timestamps, cursor boundaries, archived sources,
      null identity/context/SDK values, and malformed filters in real-store
      integration tests.

### 6. Complete the Events dashboard experience

This slice gives the hosted product a usable source-aware event explorer.

- [ ] Replace the latest-200 page with the canonical paginated query and stable
      cache keys containing project slug, filters, and cursor.
- [ ] Show columns for Event, Source, Person, Session, and Time. Source must show
      its display name plus trusted platform and archived state where relevant.
- [ ] Add URL-backed date, event-name, source, and trusted-platform filters.
      Back/forward navigation and copied URLs must reproduce the same view.
- [ ] Open an event detail panel/route that groups fields as Event,
      Attribution, Identity, Runtime/SDK, Properties, and Context.
- [ ] Render structured values with safe escaping, bounded depth/length,
      deterministic ordering where useful, wrapping, and explicit copy actions.
      Do not render raw HTML or use a textarea as a JSON viewer.
- [ ] Link person and session references only when the user is authorized for
      the corresponding project resource.
- [ ] Implement loading, empty, error, unauthorized, filtered-empty, archived
      source, and next-page states without flashing false zero values.
- [ ] Preserve table semantics on desktop and use a deliberate two-line event
      row on mobile. Keyboard focus must move predictably into and out of event
      detail.
- [ ] Configure query freshness intentionally so revisiting a project can use
      cached data while background refresh remains possible. Membership,
      project deletion, and source archive mutations must invalidate the
      affected project data.

### 7. Carry source attribution through People and Live

This slice prevents different product pages from giving contradictory answers
about the same accepted data.

- [ ] Return the source attribution required by person activity timelines using
      the same shared event list-item contract or a deliberately compatible
      projection.
- [ ] Show source name/platform on person activity rows and reuse the event
      detail experience instead of building a second payload renderer.
- [ ] Include origin source attribution in session list and WebSocket/live
      messages, then display it in Live Activity.
- [ ] Add source/platform filters to Live only when the server applies them to
      both initial and streamed results. Do not create a client-only filter
      that silently drops reconnect data.
- [ ] Keep geography semantics unchanged: Map represents coarse locations where
      sessions/events were observed, not where an application binary was
      installed. The activity list must remain useful without Mapbox.

### 8. Reconcile documentation and generated examples

This slice makes current source terminology and event contracts discoverable
outside the implementation.

- [ ] Update API and SDK docs from project-key/schema-v2 language to source
      keys and the current versioned event wire contract.
- [ ] Document the project/source/key hierarchy, source-vs-runtime platform,
      React-as-Web decision, key rotation aggregation, and archived source
      behavior.
- [ ] Generate or test setup snippets from the same source capability data used
      by the dashboard so docs and UI cannot advertise different packages.
- [ ] Add example event list/detail responses with synthetic, non-sensitive
      values and explain every nullable field.
- [ ] Cross-reference Task 14 for the hosted live proof and Task 15 for Errors.
      Do not duplicate their deployment and error-ingestion checklists here.
- [ ] Run the repository's documentation drift check after the focused code and
      contract work is complete.

## Security and privacy requirements

This work exposes more stored data to authenticated users, so authorization and
safe rendering are completion requirements rather than follow-up polish.

- [ ] Every event, person, session, source, and breakdown read must derive the
      project and verify current Better Auth organization membership.
- [ ] Non-members and cross-project identifiers must not disclose whether an
      event, source, person, or session exists.
- [ ] Source keys remain telemetry-write-only and can never call dashboard read
      endpoints.
- [ ] Secret key plaintext must not appear in database rows, logs, error
      responses, test snapshots, screenshots, or analytics properties.
- [ ] Event properties and context must be escaped and bounded in the UI.
      Known sensitive fields must follow the existing redaction policy.
- [ ] Cursor and filter validation must be schema-based, bounded, and covered by
      hostile-input tests.
- [ ] Archived sources must reject new ingestion even if a previously issued
      key has not yet expired from an external client cache.
- [ ] Source attribution must always come from trusted storage. A property named
      `source`, `platform`, or `sdk` must remain an ordinary untrusted property.

## Focused test and verification plan

Verification should be proportional to this task. Run affected package, API,
analytics API, and web tests while iterating; do not repeatedly run unrelated
applications or deployment checks.

### Contract and SDK tests

These tests prove the public data and setup surfaces.

- [ ] Shared resource/filter/cursor validation tests pass.
- [ ] Core and Browser metadata tests prove the immutable SDK descriptor.
- [ ] JavaScript and React snippets typecheck against packed package exports.
- [ ] Unsupported platform creation and nonexistent package snippets are
      rejected rather than rendered.

### API and real-store tests

These tests prove tenancy, persistence, pagination, and source history.

- [ ] Source-key ingestion stores trusted source/platform while ignoring
      conflicting client properties/context.
- [ ] Event list/detail/filter/breakdown tests pass against the real analytics
      schema, including cursor ties and archived sources.
- [ ] A source archive revokes keys, retains analytics attribution, applies the
      Task 15 error purge, and cannot cross project boundaries.
- [ ] Secret-key digest lookup, rotation, revocation, and one-time return pass
      without recoverable secret storage.
- [ ] Session and live messages expose the defined origin source consistently.

### Web tests

These tests prove the user-facing event and source workflows.

- [ ] Events filtering, pagination, caching, detail navigation, and all route
      states have focused component/integration coverage.
- [ ] People activity and Live display source attribution and retain their
      existing authorization/empty behavior.
- [ ] Source setup renders only supported, copyable recipes and preserves
      origins on a name-only update.
- [ ] Keyboard, focus restoration, responsive rows, safe JSON rendering, and
      archived-source labels pass focused accessibility checks.

### Closure gates

These gates produce the evidence required for review without broad busywork.

- [ ] Run the affected workspace tests, typechecks, lint checks, and builds
      once the focused slices pass.
- [ ] Run the security review for secret-key storage, event authorization,
      filter construction, and structured payload rendering.
- [ ] Inspect migration SQL and the final diff for accidental tenant-data loss,
      hard-deleted source history, plaintext secrets, or unrelated changes.
- [ ] Record exact commands and results in the progress log below.

## Definition of done

Task 16 is complete only when the stored source-aware event model and the
hosted dashboard tell the same truthful story.

- [ ] An authorized user can paginate and filter project events by source and
      trusted platform, then inspect a safe complete event detail.
- [ ] Event, person activity, session, and Live views show consistent source
      attribution with clear runtime/SDK distinctions.
- [ ] Archived sources cannot ingest, but their historical analytics remain
      attributable by retained name and platform.
- [ ] Web JavaScript and React setup instructions work as copied; unavailable
      mobile SDKs and nonexistent Node analytics methods are not advertised.
- [ ] Secret server keys are one-time values backed by non-recoverable lookup
      material, while publishable keys retain the required setup workflow.
- [ ] Task 14 can use the completed Events and Sources pages for its hosted
      React live proof without database inspection or synthetic UI data.
- [ ] Focused regression coverage and closure evidence are recorded, and every
      applicable checklist item is checked.

## Progress log

Implementation agents should append dated entries with the slice completed,
important decisions, affected files, focused tests, and any deliberately
deferred work. Review feedback belongs in a new review section below the log;
do not rewrite the task contract to hide unresolved findings.

### 2026-08-21 - task created

The task was created from a read-only review of the current event, source,
session, setup-snippet, and SDK metadata paths. No production code or schema
was changed as part of this planning pass.
