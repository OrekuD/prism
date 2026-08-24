# Simplified Prism documentation structure

**Status:** Implementation brief  
**Scope:** Public documentation information architecture only  
**Supersedes:** `engineering/docs-structure.md` for public sidebar decisions

This brief defines a much smaller, feature-first documentation structure for
Prism. It does not provide the replacement documentation copy. The
implementation task is to audit, consolidate, move, redirect, and rewrite the
existing pages into this structure.

The goal is simple: a developer must be able to find a feature by its name.
They must not need to understand Prism's repository, service boundaries, or
internal API topology before they can instrument an application.

## Direction

Use the user-supplied Sentry sidebar as information-architecture inspiration.
Its useful characteristic is a mostly flat list of recognizable features such
as error capture, tracing, logs, replay, configuration, source maps, and
troubleshooting.

Prism must follow that feature-first principle without copying Sentry's
product labels or advertising features Prism does not ship.

The current Prism structure is organized around internal categories:

- Analytics
- Track data
- Manage Prism
- Privacy and security
- API and SDK reference
- HTTP and realtime reference
- Deep configuration and operations trees

Those distinctions make sense to maintainers, but they create unnecessary
choices for readers. A page about events should explain how to capture an
event and where that event appears in Prism. It does not need separate
"tracking" and "analytics" branches.

## Current problems

The implementation must treat the following as structural defects, not minor
labeling issues.

- The root sidebar has eight top-level sections and roughly 67 visible leaf
  pages.
- Related concepts are split across task guides, product guides, privacy
  pages, SDK references, and service references.
- Self-hosting alone contains roughly 22 visible leaf pages despite the
  hosted product being Prism's current release priority and the self-hosted
  release pass remaining incomplete.
- Installation guidance and exact symbol reference are duplicated.
- Product UI concepts such as Events and People are separated from the SDK
  operations that produce their data.
- Contributor documentation is mixed into customer documentation.
- The analytics metadata lists `web-analytics`, but no corresponding public
  MDX page currently exists.
- Several pages describe older contracts. For example, the React guide says
  automatic page tracking is future work even though it is implemented.
- Vague labels such as **HTTP and realtime reference** expose internal service
  boundaries without telling readers what problem the section solves.

## Proposed public sidebar

Keep the primary sidebar feature-first, shallow, and honest. The target is no
more than five groups, no more than 15 visible pages, and no navigation deeper
than two levels.

```text
START
├── Quickstart
├── JavaScript SDK
└── React SDK

FEATURES
├── Capturing events
├── Page analytics
├── Identifying users
├── Sessions and live activity
└── Error tracking

CONFIGURATION
├── Projects, sources, and keys
├── Consent and privacy
└── Delivery and diagnostics

SELF-HOSTING
├── Self-host Prism
├── Install Prism
└── Configure and operate

REFERENCE
└── SDK API and limits
```

The labels above are the intended visible labels. Do not include status words,
roadmap placeholders, empty sections, or "Coming soon" links.

## Page contracts

The implementation must use these contracts to decide what existing content
belongs together. They describe page responsibilities, not finished copy.

### Quickstart

Take a hosted user from signup to a verified event with the shortest supported
path:

1. Create or select a workspace.
2. Create a project and Web source.
3. Copy a publishable source key.
4. Install the appropriate packages.
5. Initialize a client with the hosted ingestion endpoint.
6. Capture an event.
7. Verify it in Prism.

Link to **Self-host Prism** as an alternative deployment path. Do not make new
readers compare deployment architecture before they understand the product.

### JavaScript SDK

Provide the complete browser installation path using the public Browser and
Core packages. Cover client creation, lifecycle ownership, and the minimum
working setup. Link to feature pages for events, page analytics, identity,
sessions, errors, and consent instead of repeating each contract.

### React SDK

Explain that React is a thin provider and hooks layer over an already-created
Browser client. Cover the provider, the main hooks, supported React versions,
Strict Mode behavior, cleanup ownership, and links to the same feature pages.

Do not retain the stale statement that automatic route or page tracking is a
future task.

### Capturing events

Combine the useful parts of the current event tracking and Events dashboard
pages. Explain the complete feature:

- valid event names and properties;
- `track()` results and delivery meaning;
- source, session, and person attribution;
- reserved SDK event names;
- where accepted events appear in the dashboard;
- filtering, event detail, pagination, and current limitations.

The reader should not need separate "Track events" and "Analytics events"
pages.

### Page analytics

Create the missing public Web analytics guide. It must cover both capture and
interpretation:

- enabling `pageViews` on a Browser client;
- history and manual modes;
- the React page-view hook;
- path handling, title opt-in, campaign allowlists, and `beforeCapture`;
- consent and privacy boundaries;
- Web-session behavior;
- Page views, Visitors, Sessions, Views per session, and Bounce rate;
- Top pages, Referrers, Campaigns, Locations, and Technology;
- source, range, comparison, bot, and path filters;
- empty, partial-enrichment, and unavailable states.

Do not split SDK setup and dashboard metric definitions into separate sidebar
branches. Use headings and cross-links within one canonical feature guide.

### Identifying users

Combine identity, global properties relevant to identity, People, and person
privacy actions into one feature guide. Cover anonymous identity, `identify()`,
traits, reset, durable first-wins behavior at a user-facing level, People,
person detail, export, and deletion.

Use **users** in the navigation because that is what developers search for.
Explain Prism's internal **person** vocabulary on the page.

### Sessions and live activity

Combine session capture and the Live Activity dashboard experience. Explain
session start/end behavior, online state, events within a session, realtime
connection states, the map and list views, coarse location enrichment, and the
fallback when Mapbox or enrichment is unavailable.

Do not expose the WebSocket handshake or service JWT as normal setup steps.
The SDK and dashboard own that protocol.

### Error tracking

Combine initial error capture setup with the dashboard workflow. Cover Browser,
React error boundary, and supported Node capture only when each package is
published and supported. Explain sanitization, grouping, issue states,
occurrences, releases, environments, breadcrumbs, source configuration, and
the Errors dashboard.

Do not add Performance, Replay, Logs, Profiling, Tracing, or Mobile crash
reporting until those are usable product features.

### Projects, sources, and keys

Replace the scattered projects, API keys, teams, and management pages with the
smallest useful product model:

- workspace ownership and members;
- projects as product boundaries;
- sources as platform/install boundaries;
- publishable source keys;
- allowed origins for Web sources;
- source status, rotation, revocation, and archival.

Account screens and basic UI operations do not need standalone documentation
unless support evidence shows that users cannot complete them without a guide.

### Consent and privacy

Consolidate consent, anonymous persistence, data collection, identity privacy,
retention basics, export, and deletion. Keep this page focused on application
developers and product owners. Link self-hosted operational retention details
from the self-hosting page instead of duplicating them.

### Delivery and diagnostics

Combine queueing, batching, retry, offline behavior, `flush()`, `shutdown()`,
diagnostics, idempotency, and common delivery failures. This is also the main
SDK troubleshooting destination.

### Self-host Prism

State the current maturity honestly. Explain what is available, what the
supported topology is, and what has not completed a production certification
pass. Fold the current deployment-choice and self-hosting overview content
into this page.

Do not imply Kubernetes, high availability, multi-region deployment, or a
fully certified production operator experience.

### Install Prism

Consolidate requirements, architecture needed for installation, Docker
Compose setup, migrations, health verification, and first-owner bootstrap.
Architecture details that do not change the installation decision belong in
internal engineering documentation.

### Configure and operate

Consolidate the current configuration and operations trees. Use headings or
accordions within one page for:

- environment variables;
- product and analytics data stores;
- file storage;
- public domains, TLS, and proxying;
- email and authentication providers;
- health and logging;
- backup and restore;
- upgrades and retention;
- production cautions and troubleshooting.

Split this page later only when self-hosting has a completed release pass and
usage evidence shows that the page is no longer navigable.

### SDK API and limits

Provide one visible reference entry point. It may link to exact package symbol
pages for Core, Browser, React, and supported server packages, but those child
pages must not expand into another large primary sidebar tree.

This page must also be the canonical source for event, property, batch, queue,
payload, timing, pagination, and rate limits. Feature pages must link here
instead of copying changing numbers.

The implementation must inspect the installed Fumadocs version before choosing
how to keep detailed symbol pages searchable and linkable without showing all
of them in the primary navigation.

## Remove HTTP and realtime reference from the public sidebar

The current **HTTP and realtime reference** is a container for five unrelated
internal boundaries:

- batch ingestion;
- the dashboard's management API;
- analytics query endpoints;
- the dashboard WebSocket protocol;
- shared error envelopes.

That grouping does not represent a user task. Most Prism customers use SDKs
and the web app; they do not manually call the ingestion endpoint, mint service
JWTs, or implement the dashboard WebSocket protocol.

Apply these rules:

- Remove **HTTP and realtime reference** from the public sidebar.
- Move dashboard-only management and query contracts to internal engineering
  documentation if maintainers still need them.
- Explain ingestion behavior through the SDK feature and delivery pages.
- Explain realtime behavior through **Sessions and live activity**.
- Keep protocol-level WebSocket documentation internal unless Prism announces
  it as a supported public API.
- Put endpoint-specific error shapes beside a supported public endpoint, not
  in a generic standalone envelope page.
- If Prism later offers a supported public REST API, create one deliberate
  **API reference** generated or drift-checked from its source contract. Do not
  revive the current mixed service tree.

## Content consolidation map

Use the following map as the starting point. The implementation must inspect
every source page before merging it and must preserve unique accurate details.

| Current section | Destination |
| --- | --- |
| `getting-started/*` | Quickstart, JavaScript SDK, or Self-host Prism |
| `analytics/events` + `tracking/events` | Capturing events |
| `analytics/people` + `tracking/identity` | Identifying users |
| `analytics/sessions-realtime` + `tracking/sessions` | Sessions and live activity |
| Web analytics task/internal material | Page analytics |
| Error SDK and dashboard material | Error tracking |
| `tracking/web/javascript-browser` | JavaScript SDK |
| `tracking/web/react` | React SDK |
| `tracking/global-properties` | Capturing events or Identifying users |
| `tracking/consent` + `privacy-security/*` | Consent and privacy |
| `tracking/delivery` | Delivery and diagnostics |
| `management/*` | Quickstart or Projects, sources, and keys |
| `self-hosting/overview`, requirements, architecture | Self-host Prism or Install Prism |
| self-host installation and first boot | Install Prism |
| self-host configuration, operations, troubleshooting | Configure and operate |
| `reference/sdk/*` | SDK API, with detail pages hidden from primary navigation |
| `reference/api/*` | Internal engineering docs or relevant feature pages |
| `reference/limits` | SDK API and limits |
| `contributing/*` | Repository contributor documentation, not public product sidebar |

Do not perform a mechanical concatenation. Remove repeated introductions,
roadmap language, stale examples, and details that only describe internal
implementation.

## Skills and instructions for the implementation agent

Before editing the public docs, the implementation agent must read the complete
instructions for these skills. It must not delegate interpretation of their
instructions.

1. **`docs-writer`**  
   Use for the complete audit, rewrite, style, linking, and MDX work. Also read
   `docs-writer/references/docs-auditing.md`.
2. **`ecc:product-capability`**  
   Use to distinguish shipped, partially shipped, internal, deferred, and
   roadmap capabilities before deciding what may appear in public navigation.
3. **`ecc:frontend-a11y`**  
   Use when changing sidebar behavior, mobile navigation, focus behavior,
   hierarchy, and accessible names.
4. **`ecc:nextjs-turbopack`**  
   Use when changing the Next.js/Fumadocs application, route behavior, metadata,
   or build configuration.
5. **`ecc:delivery-gate`**  
   Use for final link, typecheck, lint, build, and regression verification.

The agent must also read:

- this entire brief;
- the root `AGENTS.md` instructions;
- all current `meta.json` navigation files;
- `tasks/task-14.md`, `tasks/task-15.md`, and `tasks/task-17.md`;
- the public exports and package manifests for Core, Browser, React, and Node;
- the current product routes for Events, People, Live Activity, Web Analytics,
  Errors, Sources, and project settings;
- the existing page being merged before changing or deleting it.

`engineering/docs-structure.md` is useful as an inventory of old content, but
its proposed large sidebar is explicitly superseded by this brief.

## Implementation sequence

The implementation must proceed in small, reviewable slices.

1. Inventory every visible route from the current `meta.json` files.
2. Mark every page as keep, merge, move internal, redirect, or delete.
3. Verify every retained claim and code sample against current exports and
   routes.
4. Create the new shallow metadata structure before rewriting content so the
   final destination of each page is fixed.
5. Implement one sidebar group at a time, consolidating content rather than
   copying whole pages.
6. Add redirects for every moved public route with incoming links or likely
   bookmarks.
7. Update all repository, web-app, and docs cross-links to canonical routes.
8. Remove orphaned files and metadata entries only after redirects and links
   are verified.
9. Verify desktop and mobile sidebar behavior, keyboard navigation, focus,
   active states, and search indexing.
10. Run the complete documentation quality gate and record the old and new
    visible page counts.

## Accuracy gates

The restructuring must not carry known stale claims into the new pages.

- Verify the source-key model and remove old project-key terminology.
- Verify hosted endpoints; never use `window.location.origin` in an external
  hosted SDK example unless that is actually the ingestion origin.
- Document Browser `pageViews` and the React page-view hook as implemented.
- Verify allowed-origin behavior instead of claiming unrestricted browser
  ingestion.
- Verify Better Auth organization/workspace terminology and remove stale Team
  controller assumptions from public copy.
- Document only package APIs that are intended for publication.
- Label self-hosting maturity honestly and avoid guarantees not backed by a
  completed deployed certification.
- Keep raw service tokens, internal JWT exchange, database topology details,
  and dashboard-only APIs out of normal user setup instructions.

## Acceptance criteria

The simplification is complete only when all of these statements are true.

- The primary sidebar has no more than five groups and 15 visible pages.
- A reader can reach any feature guide in at most two navigation actions.
- Features use recognizable labels rather than internal service names.
- Events, page analytics, identity, sessions, and errors each have one
  canonical end-to-end feature page.
- Self-hosting has no more than three visible pages and contains no unsupported
  production claims.
- **HTTP and realtime reference** no longer appears in the public sidebar.
- Contributor and internal service documentation no longer competes with user
  documentation.
- No visible navigation entry points to a missing page.
- No old public route with incoming links becomes an unexplained 404.
- Every code example passes against the packed or built public package.
- Documentation lint, typecheck, link validation, search indexing, and the
  production docs build pass.
- The implementation report records removed pages, merged pages, internalized
  pages, redirects, and any capability intentionally left undocumented because
  it is not ready.

## Non-goals

This restructuring must not become a roadmap expansion.

- Do not add visible pages for tracing, profiling, logs, replay, performance,
  feature flags, experiments, surveys, or mobile crash reporting.
- Do not write Kubernetes or cloud-provider deployment guides.
- Do not expose internal APIs merely because controllers exist.
- Do not preserve a page only because it already exists.
- Do not invent user demand as justification for more sidebar depth.
- Do not copy Sentry's information architecture or terminology verbatim.

The sidebar can grow later when a shipped feature needs a discoverable guide.
Until then, fewer accurate pages are better than a comprehensive-looking tree
that reflects internal architecture instead of user intent.
