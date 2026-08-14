# Proposed Prism documentation structure

This document proposes a documentation architecture based on Prism's current
dashboard, APIs, SDKs, and self-hosted deployment. It uses the supplied sidebar
as inspiration, but it includes only capabilities that exist in the repository.
It also identifies pages that need to move, split, or be rewritten before the
new navigation is published.

The main change is to organize the documentation by reader intent. A new user
can get to a first event without learning the deployment internals. A developer
can instrument an application without searching through product pages. An
operator can evaluate and run the complete self-hosted stack from one section.

## Documentation principles

The new structure follows a small set of rules so the sidebar remains useful as
Prism grows.

- Document shipped behavior, not roadmap promises.
- Give each page one primary audience and one clear job.
- Separate task-based guides from API and SDK reference material.
- Keep hosted and self-hosted product behavior together when it is identical.
- Put deployment-specific instructions under **Self-host Prism**.
- Use one canonical page for each subject, and cross-link instead of duplicating
  content.
- Keep the first successful path short: create a project, install an SDK, send
  an event, and verify it in Prism.
- Add new analytics categories to the sidebar only when the associated UI or
  public API is ready to use.

## Current product boundary

The sidebar must reflect the product that exists today. The following inventory
comes from the web routes, service routers, package exports, deployment files,
and tests in the current repository.

### Shipped capabilities

Prism currently supports the following user and developer journeys.

- Hosted and self-hosted deployment modes.
- Account creation, email verification, password recovery, optional social
  sign-in, sessions, and account security controls.
- Teams, invitations, membership, projects, project settings, and public
  write-only analytics keys.
- Explicit custom events and client-owned sessions.
- Anonymous identities, identified people, explicitly supplied traits, and
  global properties.
- People lists, person profiles, linked identities, activity timelines, exact
  external ID search, data export, and person deletion.
- Project summaries, recent events, honest totals, safe API-level breakdowns,
  and live session delivery over WebSockets.
- A runtime-neutral `@prism/core` package, a browser runtime adapter, and thin
  React bindings. React is the only framework integration shipped today.
- Explicit consent states, bounded queues, retry, deduplication, offline
  persistence, diagnostics, flush, and shutdown behavior.
- A Docker Compose self-hosted stack with PostgreSQL, libSQL/sqld, local or
  external file storage, health checks, migrations, backups, retention, and
  upgrades.

### Capabilities that must remain out of the sidebar

The following labels appear in the supplied example or project roadmap, but the
current product does not provide complete user-facing implementations for them.
They must not appear as active documentation categories yet.

- Trends, funnels, retention reports, cohorts, paths, journeys, stickiness,
  configurable dashboards, revenue analytics, and group analytics.
- Automatic page-view, route, click, form, scroll, or DOM capture.
- Session replay, heatmaps, error monitoring, performance monitoring, feature
  flags, experiments, surveys, alerts, and anomaly detection.
- Webhooks, destinations, warehouse exports, and third-party integrations.
- Vue, Svelte, Angular, React Native, Node, and server-framework SDKs. These are
  future integrations, and the documentation structure reserves a place for
  them without presenting them as available.
- Kubernetes, AWS, Google Cloud, Azure, multi-region, or high-availability
  deployment guides.
- Redis, background workers, or a separate event queue. These services are not
  part of Prism's current self-hosted topology.

## Proposed sidebar

The published sidebar must use the labels below. Status annotations are for
this planning document only and must not appear in the product navigation.

- **Keep** means that an existing page can remain largely intact.
- **Move** means that an existing page supplies most of the content but needs a
  new location or title.
- **Update** means that a page exists but no longer covers the current product.
- **New** means that the content needs a dedicated page.

```text
GET STARTED
├── Overview                                      Move
├── Choose hosted or self-hosted                  Move
├── Hosted quickstart                             Move + update
├── Self-hosted quickstart                        New
└── Core concepts                                 Update

ANALYTICS
├── Analytics overview                            New
├── Events                                        Update
├── People and profiles                           New
├── Sessions and realtime                         Move + update
└── Understand Prism metrics                      New

TRACK DATA
├── SDK overview                                  New
├── Web SDKs
│   ├── JavaScript and browser                    New
│   └── React                                     Move + update
├── Track events                                  Move + update
├── Manage sessions                               Move
├── Identify people                               Move + update
├── Set global properties                         New
├── Manage consent                                Move + update
├── Delivery, retries, and diagnostics            New
└── Write a runtime adapter                       Move

MANAGE PRISM
├── Projects                                      Move + update
├── Project API keys                              Move
├── Teams and invitations                         Move
├── Accounts and profiles                         Move
└── Authentication and sessions                   Move + update

PRIVACY AND SECURITY
├── What Prism collects                           Update
├── Consent and anonymous identity                New
├── Person data, export, and deletion             New
├── Data retention                                New
└── Security model                                Move + update

SELF-HOST PRISM
├── Overview                                      Move + update
├── Requirements                                  New
├── Architecture                                  New
├── Install with Docker Compose                   Move + update
├── Complete first boot                           Move
├── Configure Prism
│   ├── Environment variables                     Move
│   ├── Product and analytics data                New
│   ├── File storage                              Move
│   ├── Domains, TLS, and reverse proxies         Move
│   ├── Email delivery                            Move
│   ├── Authentication and registration           New
│   └── Networking and egress                     Move
├── Operate Prism
│   ├── Health checks                             Move
│   ├── Logging                                   Move + update
│   ├── Back up and restore                       Move + update
│   ├── Upgrade Prism                             Move
│   ├── Apply retention                           New
│   └── Production security checklist             New
└── Troubleshooting                               Move + update

API AND SDK REFERENCE
├── SDK reference
│   ├── @prism/core                               Move + update
│   ├── @prism/browser                            New
│   ├── Framework SDKs
│   │   └── @prism/react                          New
│   └── Runtime adapter interface                 New
├── HTTP and realtime reference
│   ├── Ingestion API                             Move + update
│   ├── Management API                            Move + update
│   ├── People and analytics queries              New
│   ├── Realtime WebSocket                        New
│   └── Errors and response envelopes             Move + update
└── Limits and validation                         New

CONTRIBUTE
├── Development setup                             Move + update
├── Repository architecture                       Move + update
└── Testing and quality                           Move
```

## Get started

This section must take a reader from no context to a verified event. It replaces
the separate **Start here** and **Hosted quickstart** branches with one visible
entry path.

### Overview

The overview explains what Prism does before it introduces installation or SDK
details. It must contain the following information.

- Define Prism as product analytics for explicit events, sessions, and people.
- Explain the hosted and self-hosted deployment modes in one paragraph each.
- Show the basic data flow from application to SDK, ingestion, storage, and
  dashboard.
- State the current product boundary and link to the roadmap instead of
  presenting future analytics features as available.
- Give readers three next actions: start hosted, self-host Prism, or instrument
  an existing project.

The existing `start/overview.mdx` is the source, but its maturity statement and
feature summary need to include the shipped people and identity capabilities.

### Choose hosted or self-hosted

This page helps a team make a deployment decision. It must compare ownership,
setup effort, updates, backups, networking, data location, and account setup.
It must not repeat the full self-hosting architecture.

The existing `start/choose.mdx` supplies most of this page.

### Hosted quickstart

The hosted quickstart must end with a real event visible in the dashboard. The
procedure must use the current package API and the following sequence.

1. Create and verify an account.
2. Create or select a team.
3. Create a project.
4. Copy the project's analytics key.
5. Install `@prism/core` and `@prism/browser`.
6. Create a browser client with an explicit endpoint and collection state.
7. Start a session and call `track()`.
8. Verify the event and session in the project dashboard.

The existing `hosted/quickstart.mdx` is the source. Every snippet must be
checked against the package exports before publication.

### Self-hosted quickstart

This page is a short operator path, not a replacement for the complete install
guide. It must state that Docker Compose is the only officially documented
deployment method, link to the requirements page, and cover these milestones.

1. Copy and complete `deploy/compose.env`.
2. Start the Compose stack.
3. Check liveness and readiness.
4. Create the first owner with the setup token.
5. Create a project and send a test event through the public origin.

### Core concepts

This page defines projects, analytics keys, events, sessions, anonymous IDs,
people, external user IDs, traits, teams, and realtime delivery. Each definition
must be short and link to the canonical guide for the full behavior.

The existing `start/concepts.mdx` needs its identity vocabulary and package
layer descriptions updated.

## Analytics

This section documents what users can inspect in the Prism dashboard today. It
must not become a placeholder tree for future analysis products.

### Analytics overview

This new page explains the project dashboard and the meaning of its current
summary metrics. It must distinguish events, sessions, identified people, and
anonymous identities so the interface never calls all of them "users" or
"visitors."

The page must also explain the selected time period, which metrics are exact,
and which screens show only a bounded recent list. API-only totals and
breakdowns must link to the reference instead of being presented as dashboard
controls.

### Events

This page explains event names, properties, timestamps, session association,
person association, and the current recent-events view. It must link to the
tracking guide for instrumentation and to the query API for filters and
breakdowns.

The existing `product/events.mdx` is stale after the v2 and identity work. It
must be checked against the current resource shape and must no longer say that
there is no analytics deletion path without explaining person deletion.

### People and profiles

This new page covers the shipped people list and person detail routes. It must
explain the following behavior.

- People appear after an explicit `identify()` operation.
- Exact external ID search is intentional; broad enumeration is unavailable.
- Trait values are hidden by default in the dashboard.
- A profile shows linked external and anonymous identities, current traits,
  event and session counts, and a chronological activity view.
- Export returns documented project-scoped analytics data.
- Deletion permanently removes the person's identity links, traits, sessions,
  and events after explicit confirmation.

### Sessions and realtime

This page combines the current session model with the live WebSocket view. It
must explain client-owned session IDs, start and end events, online state,
project-scoped subscriptions, service JWT authentication, and the optional
Mapbox display.

The existing `product/realtime.mdx` and `sdks/sessions.mdx` remain separate
source material: the user-facing behavior belongs here, while SDK methods stay
under **Track data**.

### Understand Prism metrics

This new page defines the current totals and breakdown dimensions without
claiming that Prism has funnels or trend reports. It must cover event
occurrences, unique resolved people, unique anonymous identities, sessions,
and breakdowns by event, person, session, context kind, and context platform.

The page must clearly label whether a metric is visible in the dashboard or
available only through the management API.

## Track data

This section contains task-based instrumentation guides. A reader must be
able to complete each task without scanning raw TypeScript declarations.

### SDK overview

The overview introduces the package roles, identifies React as the only shipped
framework SDK, and recommends the correct starting point for a browser or React
application.

- `@prism/core` owns event construction, identity, consent, queueing, retry,
  diagnostics, and delivery.
- `@prism/browser` supplies browser transport, storage, lifecycle, and context.
- `@prism/react` supplies a provider and hook over an existing client.

It must also state that Prism uses explicit tracking and does not currently
autocapture routes, page views, clicks, forms, or DOM content.

### JavaScript and browser

This new guide shows the normal browser setup with `@prism/core` and
`@prism/browser`. It must include package installation, project key lookup,
runtime endpoint selection, initial consent choice, client creation, first
session, first event, diagnostics, and cleanup.

The guide must use `createPrismClient()` or the actual browser factory exported
by the package. It must not use the removed `new PrismClient()` and `logEvent()`
API shown on the current docs homepage.

### React SDK

This guide shows how to create one ready client outside the render path, pass it
to `PrismProvider`, call `usePrism()`, and shut the client down. It must state
that the React package does not create a queue, infer consent, or install router
tracking.

The existing `sdks/react.mdx` supplies the starting content.

### Track events

This guide covers event naming, JSON properties, reserved or dangerous keys,
redaction, size and depth ceilings, capture results, and server-side
validation. It must include good naming examples from realistic product
flows.

The existing `sdks/events.mdx` supplies most of the content.

### Manage sessions

This guide explains `startSession()`, the returned session handle, `end()`,
already-active behavior, lifecycle integration, and how session IDs attach to
events. It must make the distinction between a session and a person explicit.

The existing `sdks/sessions.mdx` is the source.

### Identify people

This guide explains `identify()`, anonymous-to-known linking, external IDs,
traits, multi-device resolution, shared-device behavior, and `reset()` at
logout. PII must be described as developer-supplied only.

The existing `sdks/identity.mdx` is the source, but its delivery and resolution
guarantees must be reverified against the open Task 10 release review before the
new page is published.

### Set global properties

This new page extracts global properties from the identity page. It must
cover memory, session, and persistent scopes; precedence; per-event overrides;
validation; storage failure; and reset behavior.

### Manage consent

This guide explains the `pending`, `granted`, and `denied` states; what Prism
drops before consent; withdrawal cleanup; re-grant behavior; and the limit of
what an SDK consent state can enforce.

The existing `sdks/consent.mdx` is the source.

### Delivery, retries, and diagnostics

This new page extracts operational SDK behavior from `sdks/javascript.mdx`.
It must define what `queued` means, when delivery runs, batching, persisted
queues, idempotent event IDs, retry and `Retry-After` behavior, `flush()`,
`shutdown()`, queue ceilings, and diagnostic subscriptions.

### Write a runtime adapter

This advanced guide explains the transport, storage, clock, ID, scheduler,
context, and lifecycle seams required by `PrismRuntimeAdapter`. It must state
that adapters stay thin and cannot reimplement core analytics behavior.

The existing `sdks/adapters.mdx` is the source.

## SDK expansion path

The information architecture must support more SDKs without implying that they
exist today. Prism currently ships the runtime-neutral core, the browser
runtime, and one framework binding: React. Future SDKs remain hidden from the
published sidebar until their packages, examples, tests, and support boundaries
are ready.

The package and documentation model follows this shape.

```text
@prism/core                                      Shipped
├── Runtime adapters
│   ├── @prism/browser                           Shipped
│   ├── @prism/react-native                      Future
│   │   ├── Expo
│   │   └── Bare React Native
│   └── Server runtimes                          Future
│       ├── Node.js
│       └── Server-framework adapters
└── Framework bindings
    ├── @prism/react                             Shipped
    ├── Vue                                      Future
    ├── Svelte                                   Future
    └── Angular                                  Future
```

All framework SDKs must remain thin bindings over `@prism/core`. They can add
framework-specific setup, lifecycle integration, and ergonomic hooks or
plugins, but they cannot create separate implementations of identity, consent,
event construction, queueing, retry, sanitization, or delivery.

### Future web framework SDKs

Vue, Svelte, Angular, and other web integrations belong under **Track data →
Web SDKs** and **API and SDK reference → SDK reference → Framework SDKs**. Each
integration needs two pages when it ships.

- A task-based setup guide covers installation, client ownership, application
  registration, framework lifecycle, event tracking, identity, consent, and
  cleanup.
- A reference page covers the package exports, components, hooks or composables,
  plugin options, supported framework versions, and SSR boundaries.

The browser runtime remains canonical for web transport, storage, and page
lifecycle behavior. A framework package must not fork those responsibilities.

### Future React Native SDK

React Native belongs under a new **Track data → Mobile SDKs** group when the
package ships. The first documentation release must support both Expo and bare
React Native and cover the following behavior.

- Configure a React Native client over the same `@prism/core` contracts.
- Persist identity and queued events with an asynchronous storage adapter.
- Map `AppState` foreground and background transitions to session lifecycle.
- Support offline delivery and reconnect flushing.
- Expose manual event tracking, identity, reset, consent, and global properties.
- Add opt-in React Navigation screen tracking without making navigation capture
  a core responsibility.
- Capture privacy-safe app version, build, operating system, and device-class
  context without collecting advertising IDs, contacts, or exact location.
- Document bounded background flush behavior and mobile failure diagnostics.

The React Native SDK must not be documented as a browser shim. It needs its own
runtime adapter and storage and lifecycle guidance, while sharing the same
identity, privacy, validation, and ingestion contracts as the web SDKs.

### Publication gate for a new SDK

A future SDK becomes visible in the published sidebar only after it meets a
consistent release gate.

- The package exists and exports a stable public contract.
- The adapter delegates shared analytics behavior to `@prism/core`.
- Installation and minimal example applications work from packed packages.
- Supported runtime or framework versions are explicit.
- Identity, consent, offline behavior, lifecycle cleanup, and failure handling
  have tests.
- The task guide and API reference are source-checked and ship with the package.

## Manage Prism

This section documents dashboard administration. It removes these pages from
the vague **Product** category and groups them by the tasks an owner or member
performs.

### Projects

This page covers project creation, team ownership, verified-email requirements,
slugs, summary pages, settings, rename, deletion, and authorization. Its page
inventory must include **People**, which the current `product/projects.mdx`
omits.

### Project API keys

This page explains that analytics keys are public, project-scoped, and
write-only. It must cover copying, intended browser exposure, rate limits,
the current rotation behavior, and the difference between an analytics key and
a dashboard session or service JWT.

The existing `product/api-keys.mdx` supplies the content.

### Teams and invitations

This page covers personal and shared teams, creation, invite links, joining,
leaving, owner restrictions, member permissions, and deletion.

The existing `product/teams.mdx` supplies the content.

### Accounts and profiles

This page covers profile names, usernames, avatars, password changes, linked
providers, session management, and current account-deletion limitations.

The existing `product/account.mdx` supplies the content.

### Authentication and sessions

This page explains email and password authentication, verification, password
reset, optional GitHub and Google providers, HTTP-only dashboard sessions, and
short-lived service JWTs. Hosted and self-hosted differences must appear only
where configuration differs.

The existing `hosted/authentication.mdx` must move here because most of its
behavior is not hosted-only.

## Privacy and security

This section gives evaluators, privacy teams, and developers one canonical path
through Prism's data boundaries. It separates privacy behavior from self-hosted
runbooks while linking to the relevant configuration pages.

### What Prism collects

This page lists product account data, analytics events, session context,
anonymous IDs, external IDs, traits, and uploaded avatars. It must distinguish
automatic context from developer-supplied data and state clearly that raw IP
addresses are not persisted in the v2 analytics schema.

The existing `operations/privacy.mdx` needs a source-level audit. Its current
session inventory describes legacy page, referrer, user-agent, and location
fields more broadly than the v2 browser adapter and analytics schema support.

### Consent and anonymous identity

This page describes the privacy model rather than the SDK call sequence. It
must cover collection states, anonymous ID persistence choices, behavior on
withdrawal, project isolation, endpoint namespacing, and the absence of
cross-site identity.

### Person data, export, and deletion

This page explains what the person export contains, who can request it, how the
dashboard and API authorize it, how deletion is confirmed, what is removed,
and why a later use of the same external ID creates a new person.

### Data retention

This page separates live-store retention, person deletion, account deletion,
and backup retention. It must explain `ANALYTICS_RETENTION_DAYS`, the
retention command or schedule, and the fact that deleting live data does not
rewrite existing backups.

### Security model

This page covers public write keys, cookie sessions, service JWTs and JWKS,
CORS boundaries, rate limits, authorization, stored secrets, optional
integrations, and responsible disclosure.

The existing `operations/security.mdx` is the source. Its stored-data section
must be corrected because the current v2 schemas do not persist raw IP fields.

## Self-host Prism

This section is a complete evaluator and operator path. It promotes the useful
existing self-hosting material and removes the extra **Evaluation**,
**Operating**, and **Reference** layers from the sidebar.

### Overview

The first page must answer the basic questions before installation. It must
explain that Prism runs on infrastructure the operator controls and that this
controls data location, networking, secrets, retention, backups, upgrades, and
availability.

It must end with links to **Requirements**, **Architecture**, and **Install
with Docker Compose**. The current `self-hosting/evaluation/overview.mdx`
contains the raw material but combines too many decisions into one page.

### Requirements

This new page provides a preflight checklist. It must list a Linux host,
Docker with Compose v2, CPU and memory guidance, persistent disk needs, a
production domain, TLS termination, required ports, required secrets, and
optional mail, social authentication, geo, and external storage credentials.

Sizing guidance must be presented as an evaluation baseline, not a scaling
guarantee. The current repository supports the single-host Compose topology and
does not yet document multi-replica operation.

### Architecture

This new page must show the actual services in `deploy/compose.yml`, not the
PostgreSQL, Redis, object-storage, queue, and worker example from the supplied
text.

```text
Browser application
       |
       | events and identity operations
       v
+--------------------- public Prism origin ----------------------+
|                                                                 |
|  Web / nginx                                                    |
|  ├── dashboard assets                                           |
|  ├── /api/v1/* and /api/auth/* ───────────> Product API         |
|  ├── /api/v2/ingest ──────────────────────> Analytics API       |
|  ├── /ws ─────────────────────────────────> Analytics API       |
|  └── /files/* ─────────────────────────────> Product API        |
|                                                                 |
+-----------------------------------------------------------------+
                |                              |
                v                              v
        PostgreSQL 16                    libSQL / sqld
   accounts, teams, projects,       events, sessions, people,
    keys, auth, configuration       identities, and traits
                |
                v
      local uploads volume or
     configured external storage
```

The page must explain each service and the following boundaries.

- `web` is the only public service in the default stack.
- `api` owns authentication, accounts, teams, projects, setup, uploads, and
  management reads.
- `analytics` owns ingestion and realtime WebSocket delivery.
- `migrate` runs forward-only PostgreSQL migrations before the product API.
- `db` stores product and authentication data.
- `sqld` stores analytics data, including events, sessions, people, identity
  links, and traits.
- The product API also reads the analytics store for dashboard queries.
- The default Docker network is internal, and the docs service is optional.

The contributor architecture page must link here for deployment topology and
keep only codebase and adapter details.

### Install with Docker Compose

This remains the one recommended installation method. The page must cover
environment setup, secret generation, startup, migration behavior, readiness,
named volumes, local development overlays, and the next step.

Do not add equally prominent Docker, Kubernetes, or cloud deployment branches
until Prism maintains and tests those deployment methods.

### Complete first boot

This page covers the setup token, `/setup`, owner creation, the one-time setup
claim, concurrency, recovery, and when the endpoint closes.

The existing `self-hosting/evaluation/first-boot.mdx` supplies the content.

### Configure Prism

The configuration subtree separates long reference tables from explanatory
guides. It must contain the following pages.

- **Environment variables** is the complete, source-checked configuration
  reference with required values, defaults, secrets, and restart requirements.
- **Product and analytics data** explains PostgreSQL versus libSQL/sqld,
  migrations, volumes, connection settings, and data ownership.
- **File storage** explains local, S3-compatible, and ImageKit drivers and the
  validation requirements for each.
- **Domains, TLS, and reverse proxies** explains the single public origin,
  Caddy, Traefik, the bundled nginx path, WebSocket upgrades, and forwarded
  headers.
- **Email delivery** explains SMTP precedence, Resend fallback, mail templates,
  development behavior, and verification troubleshooting.
- **Authentication and registration** explains setup tokens, signup policies,
  email verification, social provider credentials, callback URLs, and session
  secrets.
- **Networking and egress** explains ports, the internal Compose network,
  optional outbound integrations, trusted proxies, and CORS origins.

### Operate Prism

The operations subtree must provide short, command-oriented runbooks for the
following recurring tasks.

- **Health checks** documents liveness, readiness, and what each service checks.
- **Logging** documents service output, request correlation, sensitive values,
  and the absence of a complete central redaction pipeline where applicable.
- **Back up and restore** covers PostgreSQL, sqld data, uploads, configuration,
  verification, and restore drills.
- **Upgrade Prism** covers backups, image changes, forward-only migrations,
  health verification, and rollback boundaries.
- **Apply retention** covers configuration, dry-run or validation behavior if
  available, scheduling, deletion scope, and backup implications.
- **Production security checklist** turns the security model into a deployment
  gate: secrets, TLS, exposed ports, signup policy, mail, CORS, trusted proxy,
  storage access, backups, and update cadence.

### Troubleshooting

One troubleshooting page must cover first boot, authentication, mail,
ingestion, realtime, storage, data stores, upgrades, and diagnostics. The
current `self-hosting/reference/troubleshooting.mdx` is a good symptom-to-cause
base and must remain the only troubleshooting page until its size requires a
split.

## API and SDK reference

Reference pages document exact contracts. They must not carry installation
or conceptual explanations that belong in task-based guides.

### SDK reference

The SDK subtree must be generated or drift-checked against public package
declarations wherever possible.

- **`@prism/core`** lists the factory, client methods, results, options,
  diagnostics, constants, validation, limits, and public types.
- **`@prism/browser`** lists the browser client or runtime factory, storage and
  lifecycle behavior, context capture, and browser-only requirements.
- **`@prism/react`** lists `PrismProvider`, `usePrism()`, the returned facade,
  peer versions, and lifecycle ownership.
- **Runtime adapter interface** lists transport, storage, clock, ID, scheduler,
  context, and lifecycle contracts.

The existing `api-reference/core.mdx` is currently absent from
`api-reference/meta.json`; the new navigation must expose it after checking it
against the built declarations.

### HTTP and realtime reference

The service reference must mirror the mounted route boundaries.

- **Ingestion API** documents `POST /api/v2/ingest`, bearer project-key
  authentication, v2 and v3 envelopes, event and identity operations,
  idempotency, validation, rate limits, and responses.
- **Management API** documents configuration, setup, user, team, project, and
  authentication boundaries with their real paths and methods.
- **People and analytics queries** documents list, detail, activity, export,
  deletion, filtered events, totals, and supported breakdown dimensions.
- **Realtime WebSocket** documents `/ws`, the `connect-project` message,
  service JWTs, project authorization, pushed message shapes, and closure
  behavior.
- **Errors and response envelopes** documents success and error shapes, stable
  codes, authentication failures, validation failures, and pagination.

The current management page incorrectly describes project creation as
`POST /projects`; the mounted route is `POST /api/v1/projects/:teamId` and must
be used in the new reference.

### Limits and validation

This new page is the canonical inventory for event names, IDs, properties,
batch size, queue size, request size, people query bounds, pagination, rate
limits, image uploads, and authentication input. Other pages must link here
instead of copying numbers that can drift.

## Contribute

This section remains last because its audience is repository contributors, not
Prism users or operators.

### Development setup

This page covers Node and Yarn versions, dependency installation, local
environment files, databases, migrations, workspace commands, and local service
URLs. It must identify the docs app as Next.js and Fumadocs, not Astro
Starlight.

### Repository architecture

This page covers workspaces, product and analytics store boundaries, runtime
adapters, authentication, route ownership, and deployment modes. It must link
to the self-hosted architecture page rather than repeat the service diagram.

### Testing and quality

This page covers unit, integration, browser, security regression, E2E,
certification, coverage, lint, type checking, and documentation drift checks.
It must distinguish default tests from opt-in suites that require isolated
data stores.

## Proposed content tree

The filesystem can mirror the reader-facing structure. The exact migration can
be staged, but new pages must use these destinations to avoid another round
of redirects.

```text
apps/docs/content/docs/
├── index.mdx
├── getting-started/
│   ├── overview.mdx
│   ├── choose-deployment.mdx
│   ├── hosted-quickstart.mdx
│   ├── self-hosted-quickstart.mdx
│   └── concepts.mdx
├── analytics/
│   ├── overview.mdx
│   ├── events.mdx
│   ├── people.mdx
│   ├── sessions-realtime.mdx
│   └── metrics.mdx
├── tracking/
│   ├── overview.mdx
│   ├── web/
│   │   ├── javascript-browser.mdx
│   │   └── react.mdx
│   ├── events.mdx
│   ├── sessions.mdx
│   ├── identity.mdx
│   ├── global-properties.mdx
│   ├── consent.mdx
│   ├── delivery.mdx
│   └── runtime-adapters.mdx
├── management/
│   ├── projects.mdx
│   ├── api-keys.mdx
│   ├── teams.mdx
│   ├── accounts.mdx
│   └── authentication.mdx
├── privacy-security/
│   ├── data-collection.mdx
│   ├── consent-identity.mdx
│   ├── person-data.mdx
│   ├── retention.mdx
│   └── security-model.mdx
├── self-hosting/
│   ├── overview.mdx
│   ├── requirements.mdx
│   ├── architecture.mdx
│   ├── installation.mdx
│   ├── first-boot.mdx
│   ├── configuration/
│   │   ├── environment-variables.mdx
│   │   ├── data-stores.mdx
│   │   ├── file-storage.mdx
│   │   ├── domains-tls.mdx
│   │   ├── email.mdx
│   │   ├── authentication.mdx
│   │   └── networking.mdx
│   ├── operations/
│   │   ├── health.mdx
│   │   ├── logging.mdx
│   │   ├── backup-restore.mdx
│   │   ├── upgrades.mdx
│   │   ├── retention.mdx
│   │   └── production-security.mdx
│   └── troubleshooting.mdx
├── reference/
│   ├── sdk/
│   │   ├── core.mdx
│   │   ├── browser.mdx
│   │   ├── frameworks/
│   │   │   └── react.mdx
│   │   └── runtime-adapter.mdx
│   ├── api/
│   │   ├── ingestion.mdx
│   │   ├── management.mdx
│   │   ├── analytics-queries.mdx
│   │   ├── realtime.mdx
│   │   └── errors.mdx
│   └── limits.mdx
└── contributing/
    ├── development.mdx
    ├── architecture.mdx
    └── testing.mdx
```

Every directory needs a `meta.json` file that defines the visible order. The
root `meta.json` must order the sections exactly as the proposed sidebar.

When another web framework SDK ships, add its guide beside
`tracking/web/react.mdx` and its reference beside
`reference/sdk/frameworks/react.mdx`. When React Native ships, add a
`tracking/mobile/react-native.mdx` guide and a matching SDK reference. Do not
create empty future pages or visible placeholder navigation.

## Migration map

The current pages can be migrated without throwing away the strongest content.
This map identifies the canonical destination for each current section.

| Current section                          | New destination                                   | Action                                                      |
| ---------------------------------------- | ------------------------------------------------- | ----------------------------------------------------------- |
| `start`                                  | `getting-started`                                 | Rename, update concepts, and retain redirects.              |
| `hosted/quickstart`                      | `getting-started/hosted-quickstart`               | Move and verify every snippet.                              |
| `hosted/authentication`                  | `management/authentication`                       | Move and remove hosted-only framing.                        |
| `product/events`                         | `analytics/events`                                | Rewrite for v2 identity and deletion behavior.              |
| `product/realtime`                       | `analytics/sessions-realtime`                     | Merge user-facing session and realtime concepts.            |
| `product/projects`                       | `management/projects`                             | Move and add the People routes.                             |
| `product/api-keys`                       | `management/api-keys`                             | Move.                                                       |
| `product/teams`                          | `management/teams`                                | Move.                                                       |
| `product/account`                        | `management/accounts`                             | Move and verify account controls.                           |
| `sdks/*`                                 | `tracking/*` and `reference/sdk/*`                | Split guides from exact symbol reference.                   |
| `api-reference/*`                        | `reference/api/*`                                 | Move, expose core separately, and correct route drift.      |
| `operations/privacy`                     | `privacy-security/data-collection`                | Rewrite against v2 schemas.                                 |
| `operations/security`                    | `privacy-security/security-model`                 | Move and correct stored-data claims.                        |
| `operations/health`                      | `self-hosting/operations/health`                  | Move.                                                       |
| `operations/mail`                        | `self-hosting/configuration/email`                | Move.                                                       |
| `operations/logging`                     | `self-hosting/operations/logging`                 | Move and distinguish current from planned behavior.         |
| `operations/networking`                  | `self-hosting/configuration/networking`           | Move.                                                       |
| `self-hosting/evaluation/*`              | `self-hosting/*`                                  | Flatten and split overview, requirements, and architecture. |
| `self-hosting/operating/*`               | `self-hosting/configuration/*` and `operations/*` | Move by task.                                               |
| `self-hosting/reference/troubleshooting` | `self-hosting/troubleshooting`                    | Flatten.                                                    |
| `contributing/*`                         | `contributing/*`                                  | Keep, update names, and remove duplicated topology.         |

Old paths must redirect to their new destinations because the web app,
homepage, repository README, and existing docs contain direct `/docs/...`
links.

## Immediate accuracy fixes

The structure migration must not move known errors unchanged. These fixes are
the first publication gate.

1. Replace the docs homepage's `new PrismClient()` and `logEvent()` example
   with the current async factory and `track()` API.
2. Update the docs homepage and root README to identify `apps/docs` as Next.js
   with Fumadocs.
3. Add the current `api-reference/core.mdx` page to navigation until it moves
   to the new SDK reference section.
4. Correct the management API project-creation path to
   `POST /api/v1/projects/:teamId`.
5. Add **People** and person detail behavior to the project documentation.
6. Rewrite the privacy and security stored-data inventories against the v2
   migrations, which do not persist raw IP columns.
7. Recheck identity-only delivery, offline identify restore, anonymous-link
   resolution, server-side trait redaction, and global-property validation
   before documenting those behaviors as release guarantees.
8. Remove or fix stale `new PrismClient()` and `logEvent()` examples in the web
   onboarding and overview routes so product copy and docs teach one API.
9. Check the E2E and CI references that still target legacy
   `/api/v1/analytics/*` paths against the current `/api/v2/ingest` boundary.
10. Verify the external ADR links in contributor architecture; the referenced
    root `docs/adr` path is not present in this workspace.

## Content standards for the new pages

Each page must follow the same compact structure so users can predict where
to find an answer.

1. Start with a two- or three-sentence summary that states the page outcome.
2. State prerequisites before procedures.
3. Put the recommended path first and label alternatives clearly.
4. Use complete, tested examples with realistic event and property names.
5. Distinguish a requirement with "must" and a recommendation with "we
   recommend."
6. Mark experimental or incomplete behavior near the first mention.
7. Put exact methods, fields, response shapes, and ceilings in reference pages.
8. Link to canonical privacy and security pages instead of repeating claims.
9. Keep `audience`, `scope`, and `lastReviewed` frontmatter on every page.
10. End task-based pages with the next action a reader is likely to take.

## Rollout order

The migration must be incremental so existing links continue to work while
the new information architecture takes shape.

1. Fix the immediate accuracy issues and add missing Task 10 product pages.
2. Create the new `meta.json` navigation and destination folders.
3. Build **Get started**, **Analytics**, and **Track data** first because they
   define the primary product journey.
4. Move **Manage Prism** and **Privacy and security**, preserving redirects.
5. Flatten and expand **Self-host Prism**, including the requirements and
   architecture pages before changing installation links.
6. Split task guides from **API and SDK reference** and connect the existing
   declaration-drift checks.
7. Update every link from the docs homepage, web app, README, and existing MDX
   content.
8. Run formatting, the docs build, type checking, link checks, and the API drift
   check before publishing the new sidebar.

## Future navigation gates

New top-level analytics or deployment categories must be added only when a
reader can complete a real task. A roadmap item does not qualify on its own.

For example, add **Funnels** only when users can define a sequence, choose a
time window, run the query, understand conversion and drop-off, and revisit the
result. Add **Kubernetes** only when Prism publishes maintained manifests or a
chart, documents secrets and persistence, verifies upgrades, and tests the
deployment in CI.

This rule keeps the sidebar honest, compact, and aligned with the product.
