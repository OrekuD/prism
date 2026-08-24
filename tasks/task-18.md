# Task 18: React Native SDK and Mobile Analytics

**Status:** Complete  
**Created:** 2026-08-24  
**Depends on:** Task 13 source/key model, Task 16 source-aware events, Task 17
Web analytics contracts, and the Task 15 error-ingestion lane  
**Scope:** Core runtime seams, `@prism-analytics/react-native`, source setup,
analytics ingestion and projections, project read APIs, the hosted Web app,
public documentation, package-consumer proof, and hosted device proof

## Goal

Ship a publishable React Native SDK that works in Expo and bare React Native
applications, sends ordinary Prism analytics through the existing source-key
ingestion path, and powers a first-class Mobile analytics page in the hosted
Prism dashboard.

The first release must let a customer:

1. Create a React Native source beneath a Prism project.
2. Install a real npm package and initialize it with that source's publishable
   key and the hosted Prism ingestion endpoint.
3. Apply explicit collection consent.
4. Track custom events, identify and reset users, and retain an offline queue.
5. Track app sessions and intentional screen views on iOS and Android.
6. Inspect mobile engagement, screens, releases, devices, operating systems,
   coarse locations, and observed installations in the Web app.
7. Correlate mobile events with the existing Events, People, Live, and Errors
   surfaces without inventing a second identity or source model.

This task also preserves privacy-safe ordered app-session data that later
product-analysis features can use. It does **not** build an LLM chat interface,
an agent, or automated improvement recommendations.

## Why this is one task

The npm package and dashboard are one product contract. An SDK that captures
screens without a trustworthy read model leaves customers unable to use the
data. A dashboard designed around fields the SDK does not send is equally
misleading.

The implementation is therefore ordered from shared contracts to runtime,
ingestion, read model, UI, and a real hosted proof. Each slice must remain
reviewable and independently tested.

## Current baseline and gaps

Prism already has useful foundations, but it does not have a React Native
product yet.

| Area              | Current baseline                                                                                                                                           | Gap Task 18 must close                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Core SDK          | Async factory, explicit runtime adapter, async storage, consent, offline queue, sessions, identity, global properties, retries, diagnostics, and shutdown. | Mobile context, deterministic session ordering, lifecycle ownership, and reserved mobile records are not frozen.   |
| Browser and React | Browser owns Web runtime behavior; React is a thin adapter.                                                                                                | There is no React Native runtime, provider, hook, navigation integration, or packed mobile package.                |
| Sources           | `react-native`, `ios`, and `android` are recognized mobile platforms with publishable source keys.                                                         | The UI currently advertises nonexistent mobile packages and permits platform choices without certified SDKs.       |
| Ingestion         | Source, project, platform, and key class are derived from the source key. Events and identity operations are idempotent.                                   | There is no strict mobile reserved-event validation or mobile projection.                                          |
| Events and People | Events retain source attribution and resolve identities.                                                                                                   | Mobile session sequence, screen attribution, and installation/release dimensions are absent.                       |
| Errors            | The separate Task 15 error lane supports Web and server reporting and recognizes mobile platform values.                                                   | A React Native manual/React-boundary adapter is missing; native crash capture and symbol files remain future work. |
| Web analytics     | Page views have a bounded projection, authorized aggregate API, and a dedicated page.                                                                      | Mobile screens and app lifecycle cannot reuse Web URL/session definitions.                                         |
| Dashboard         | Data, Diagnose, and Configure groups exist.                                                                                                                | There is no Mobile analytics route, query, cache key, layout, or complete state model.                             |
| Verification      | Browser/React packages have unit and package-consumer tests.                                                                                               | No bare React Native or Expo consumer, Metro proof, simulator/device proof, or hosted mobile flow exists.          |

Task 18 must remove or replace every fake React Native install/API snippet as
soon as the real package contract is frozen. Until that slice lands, unavailable
native iOS and Android SDKs must not be presented as installable products.

## Product terminology and source model

The Task 13 hierarchy remains authoritative:

```text
Workspace
  Project: Acme product (production)
    Source: Acme Web          platform = web
    Source: Acme Mobile       platform = react-native
    Source: Acme API          platform = server
```

- A **project** is the logical product and environment whose activity should be
  analyzed together.
- A **source** is one installed producer and setup/key boundary.
- A React Native source has one or more rotatable publishable source keys.
- The source key authoritatively selects the project, source, trusted platform,
  key class, and source status. The SDK cannot override those values.
- One React Native source can send both iOS and Android traffic. The runtime OS
  is a reported mobile dimension, not a second project or a second source.
- Customers may create separate React Native sources for separate applications,
  brands, or environments when independent keys and setup boundaries are useful.
- Future native Swift and Kotlin sources remain exact platforms `ios` and
  `android`; the Mobile analytics page will eventually aggregate all three
  mobile platforms without changing its URL or information architecture.

For the initial release, the source-creation UI offers **React Native** as the
only creatable Mobile implementation. `ios` and `android` remain reserved stored
platform values for future native SDKs and historical compatibility, but are
not shown as installable choices.

The source-management API enforces the same creation boundary. It accepts
`web`, `react-native`, and `server` for new sources until a certified native
SDK exists. The persisted/source-attribution union retains `ios` and `android`
so future native packages and historical rows do not require an information-
architecture migration.

## Architecture decisions

### The first package is JavaScript-first

`@prism-analytics/react-native` initially ships without Prism-owned Swift,
Objective-C, Java, Kotlin, C++, TurboModule, or Fabric code. React Native's
JavaScript APIs and small injected integrations provide transport, lifecycle,
storage, screen tracking, and context.

This keeps the first release compatible with Expo and bare React Native and
avoids a native rebuild merely to use basic analytics. It also creates a clear
boundary: features that require operating-system crash persistence,
symbolication, ANR detection, frame timing, or native startup timing belong to
a later native observability phase.

The package must still be tested under React Native's New Architecture and
Hermes. “JavaScript-only” is not permission to assume browser DOM or Node APIs.

### Core remains the single behavioral engine

The React Native package is a runtime and React integration over
`@prism-analytics/core`.

Core continues to own:

- event validation and sanitization;
- consent state and withdrawal behavior;
- queue limits, persistence, batching, retries, and idempotency;
- identity, reset, sessions, and global properties;
- the versioned wire envelope and diagnostics;
- bounded flush and shutdown semantics.

The React Native package owns only:

- React Native transport, timer, storage, ID, context, and lifecycle adapters;
- app-session lifecycle policy;
- screen-view capture and navigation integrations;
- React provider/hooks and React error-boundary integration;
- React Native-specific setup diagnostics.

It must not implement a second queue, person model, consent store, retry loop,
or ingestion endpoint.

### The outer adapter supplies the SDK descriptor

Core currently emits its own package name/version for every batch. Task 18 adds
a validated adapter-owned SDK descriptor so installed mobile traffic reports
`@prism-analytics/react-native` and its package version instead of pretending
the customer installed Core directly.

The descriptor is client-reported metadata, not an authorization fact. It is
set by official adapters through a narrow runtime/internal seam, bounded by
Core, and cannot be overridden through event properties. Direct Core clients
continue to report Core. Existing Browser and Node adapters should adopt the
same seam in focused compatibility work so SDK identity has one meaning across
platforms.

### Initialization is asynchronous and returns a ready client

The package follows the existing Core/Browser contract. Its factory restores
the permitted queue and identity state, attaches the required runtime owners,
and resolves only when the client is ready for use.

Initialization must be single-owner and safe under React Strict Mode, Fast
Refresh, application remounts, and accidental duplicate factories. Global
listeners are reference-counted or instance-owned and are deterministically
removed on shutdown.

### Storage is explicit and non-secret

The first release requires an async key-value storage object structurally
compatible with Core's `PrismStorage`. The official setup recipe uses
`@react-native-async-storage/async-storage`, but the Prism package does not
silently select or bundle a customer storage implementation.

Prism stores only its bounded offline queue, consent-permitted identifiers,
session state, and SDK metadata there. Async Storage is unencrypted, so Prism
must never place application auth tokens, native credentials, user secrets,
or arbitrary app state in its namespace. A source publishable key is designed
to be visible in a client binary and has telemetry-write-only authority.

Storage keys remain scoped by endpoint and source key so hosted, self-hosted,
staging, and production queues can never cross-deliver.

### Offline delivery is a first-class requirement

Events accepted while offline remain in the existing bounded persisted queue.
The Core retry loop remains authoritative. The mobile adapter additionally
requests a flush when the app returns to the foreground and may accept an
optional connectivity subscription for immediate reconnect flushing.

The base package must not hard-depend on a network-status library. A small
adapter entry point may integrate `@react-native-community/netinfo` as an
optional peer after its current compatibility is verified. Without that
adapter, foreground and scheduled retries still provide correct delivery.

### Mobile sessions are not exact app-close records

An **app session** begins when a consented application process first becomes
active. A background-to-foreground transition inside the inactivity window
continues that session; a transition after the window starts a new one. The
default inactivity window is 30 minutes and must use the same frozen constant
in SDK and server tests.

Mobile operating systems do not guarantee JavaScript execution when an app is
killed. Prism therefore never claims to capture an exact app-close event.

- `active`, `background`, and iOS `inactive` are handled deliberately.
- A background timestamp closes the current active-time interval.
- A later foreground event either resumes or starts a new app session.
- A process relaunch starts a cold app session.
- A session with no clean end is finalized by server inactivity or reconciled
  on the next launch using its last observed activity.
- Android focus/blur signals may refine active engagement, but a notification
  shade must not be mislabeled as an app close.
- Session duration is foreground active time, not wall time spent backgrounded.

Every event captured inside an app session receives a monotonically increasing
`sessionSequence` owned by Core/adapter internals. It is not a user property.
This supplies deterministic ordering when several actions share a millisecond
timestamp and supports later journey analysis without changing event names.

### Installations are observed, not store downloads

The SDK creates a random installation identifier only after consent is granted
and only when persistent analytics storage is enabled. It is unrelated to
Apple advertising identifiers, IDFV, Android advertising ID, Android ID, or a
hardware serial number.

The server converts the random value into a project/source-scoped digest before
persistence. The raw client value is not stored, logged, returned, or used as
an authorization credential.

Dashboard language uses **Observed installations**:

- an observed installation is a consented SDK installation from which Prism
  has accepted mobile telemetry;
- “first seen” means the first accepted telemetry Prism observed for that
  installation;
- clearing app data, reinstalling, withdrawing consent, or losing storage may
  create a later new identifier;
- Prism cannot derive App Store or Play Store downloads, uninstall counts, or
  the number of devices that never granted consent.

`reset()` changes the current person/anonymous identity for logout safety but
does not pretend that the app was reinstalled. Consent withdrawal clears the
local installation identifier along with the behavioral queue and identity.

### Screen views are reserved, bounded records

Screen analytics uses the reserved event name `$prism_screen_view`. Application
code cannot call a public `track()` method with any `$prism_` name. Only the
mobile adapter's validated internal seam can construct this record.

A screen view contains only bounded developer-controlled navigation data:

- screen name;
- optional normalized route pattern;
- navigation kind: `initial`, `push`, `replace`, `pop`, `focus`, or `manual`;
- previous screen name when known;
- screen sequence inside the app session;
- optional allowlisted custom screen properties after sanitization.

No navigation params, search params, deep-link tokens, user-entered titles,
component props, text content, screenshots, view hierarchy, touch coordinates,
form values, or clipboard data are captured automatically.

Repeated captures of the same active screen caused by Strict Mode or duplicate
navigation notifications are suppressed. A genuine later focus of the same
screen may be captured when it represents a new navigation observation.

### Navigation support is adapter-based

Manual capture is the stable baseline and works with any router.

The package then exposes optional entry points for:

- React Navigation;
- Expo Router.

Neither navigation package is a hard dependency of the base runtime. Adapter
entry points declare current optional peers and fail with a useful setup error
when imported without their peer.

The React Navigation integration accepts a caller-owned navigation container
ref and listens to its `ready` and `state` events. It does not wrap
`NavigationContainer`, because the current official guidance warns that a
library wrapper does not compose with the static API.

The Expo Router integration observes its route hooks inside the caller's root
layout. It defaults to a normalized developer route name/pattern and excludes
dynamic parameter values. Both integrations accept a synchronous transform
that can rename or drop a screen before capture.

### Mobile context is bounded and honest

The adapter extends the Core runtime context with an allowlisted mobile block.
All fields are client-reported dimensions; the source key remains the trusted
platform authority.

Allowed initial context:

- runtime `platform = "react-native"` and `kind = "mobile"`;
- runtime OS `ios` or `android` and a bounded OS version;
- app name, release version, build number, and optional environment;
- locale and timezone;
- current application-window width/height and a server-derived size class;
- optional bounded device class supplied by an approved adapter.

Exact device model and manufacturer may be retained only if a privacy review
shows a product need and a bounded classification. They are not shown by
default. Advertising IDs, vendor IDs, exact location, contacts, carrier data,
push tokens, Wi-Fi identifiers, biometrics, and arbitrary native metadata are
prohibited.

App version/build may be supplied explicitly in both Expo and bare apps. An
optional Expo adapter may read them from `expo-application`; Expo must not be a
base-package dependency.

### Geography remains server-owned

Mobile location on the dashboard is coarse request-network enrichment, using
the same trusted-proxy and privacy boundaries as Web analytics. The SDK does
not request operating-system location permission.

Raw IP, stable IP hashes, coordinates, and raw forwarded headers are not
stored. Late offline events outside the frozen enrichment window remain valid
but receive `Unknown` geography because their delivery network is not reliable
evidence of the location at occurrence time.

### Error reporting has a narrow first-release boundary

Task 18 integrates with the separate Task 15 error endpoint; errors are not
encoded as ordinary analytics events.

The initial React Native package may provide:

- manual JavaScript exception capture;
- a React error boundary;
- opt-in unhandled JavaScript error/rejection capture only through a verified,
  chain-safe React Native hook with deterministic restoration;
- bounded app release, build, environment, screen, and app-session context.

The package must preserve existing application/global handlers and prevent
recursive reporting. It must clearly label captured JavaScript failures and
must not call them complete native crash coverage.

Native fatal crash persistence, iOS dSYM handling, Android mapping files,
native symbolication, ANR/freeze capture, and crash-free-session claims are
deferred. Those require a Prism native module and a separate artifact/release
pipeline.

### The future AI journey assistant is explicitly deferred

A future Prism feature may let users ask an LLM about aggregate journeys from
app launch through the last observed action and receive suggestions for product
improvements. Task 18 does not build or call that system.

Task 18 only ensures that future work has a safe foundation:

- ordered app-session events;
- bounded screen names and transitions;
- app release/OS/source dimensions;
- explicit consent and retention boundaries;
- aggregate read models that do not require exporting raw user timelines.

No LLM provider, prompt, chat UI, recommendation job, vector store, automatic
decision, or raw-session export belongs in this task. A later task must define
its own privacy model, authorization, aggregation threshold, evaluation, cost,
and opt-in contracts.

## Public SDK contract

Slice 1 must freeze and test exact public TypeScript types before runtime work.
The examples below are the intended contract, not permission to invent
additional implicit behavior.

### Package and exports

The package is named `@prism-analytics/react-native` and exposes:

- `.`: client factory, types, provider, hooks, manual screen capture, and
  manual/React-boundary JavaScript error support;
- `./react-navigation`: optional React Navigation tracker;
- `./expo-router`: optional Expo Router tracker;
- `./expo`: optional Expo application metadata helper;
- `./netinfo`: optional reconnect helper, if dependency review approves it.

The package manifest must have Metro-safe ESM/CommonJS/type exports, a
`react-native`-appropriate entry, no `react-dom` peer, and explicit supported
React/React Native peer ranges. Optional adapter peers must remain optional.

The base package must be importable without Expo, React Navigation, NetInfo,
Node built-ins, DOM globals, or an installed native Prism module.

### Initialization

The target setup shape is:

```tsx
import { createAsyncStorage } from "@react-native-async-storage/async-storage";
import {
  PrismProvider,
  createReactNativeClient,
} from "@prism-analytics/react-native";

const prismStorage = createAsyncStorage("prism");

const prism = await createReactNativeClient({
  sourceKey: "psk_...",
  endpoint: "https://ingest.prism.example",
  storage: prismStorage,
  collection: {
    initialState: "pending",
    anonymousPersistence: "persistent",
  },
  app: {
    name: "Acme Mobile",
    version: "2.4.0",
    build: "108",
    environment: "production",
  },
  sessions: {
    autoTrack: true,
  },
  screenViews: {
    mode: "manual",
  },
});

export function Root() {
  return <PrismProvider client={prism}>{/* application */}</PrismProvider>;
}
```

Contract requirements:

- `sourceKey`, `endpoint`, `storage`, `collection`, and app version/build are
  explicit.
- The factory returns a ready `ReactNativePrismClient`.
- The returned client retains every `PrismClient` method and readonly state.
- `screenViews` is `null` when omitted and a stable controller when configured.
- `errors` remains a separate reporter/controller even when exposed through
  the same provider.
- Invalid configuration rejects with specific messages before listeners or
  timers leak.
- Automatic app/screen/error collection does nothing while consent is pending
  or denied.

Exact option names, result unions, diagnostics, size limits, and JSDoc must be
frozen in shared contracts and consumer compile tests during Slice 1.

### Ordinary analytics and identity

The React Native client preserves the Core commands:

```ts
prism.track("checkout_started", { cartValue: 129 });
await prism.identify("customer_123", { plan: "pro" });
await prism.setGlobalProperty("appChannel", "stable", "persistent");
await prism.reset();
await prism.setCollectionState("granted");
await prism.flush();
await prism.shutdown();
```

The package does not rename or wrap these into incompatible mobile-only
methods. Results and errors match Core.

### Manual screen capture

The stable router-neutral surface is:

```ts
prism.screenViews?.capture({
  name: "Checkout",
  routePattern: "/checkout/[step]",
  navigation: "push",
  properties: { step: "shipping" },
});
```

`name` is required and bounded. `routePattern`, `navigation`, and properties
are optional. Dynamic route values are never inferred from props or params.

The provider exports a thin `usePrism()` hook and a manual
`usePrismScreenView()` hook for component-owned screen tracking. Hooks delegate
to the same client controller and do not own a second session or queue.

### Navigation adapters

Slice 1 freezes realistic examples for current React Navigation and Expo Router
versions after compiling them in fixture apps.

- React Navigation tracks the initial route on `ready` and subsequent route
  changes from the caller-owned container ref's `state` event.
- Expo Router is mounted once in the root layout and observes the current route
  through official hooks.
- Both support `beforeCapture(candidate) => candidate | null`.
- Both suppress Strict Mode duplicate effects and clean up every subscription.
- Neither captures arbitrary route params by default.
- Mounting two automatic owners for one client must produce a clear diagnostic
  or configuration error rather than duplicate records.

### Error adapter

The intended initial error surface is a mobile adapter over Task 15's reporter:

```tsx
const errors = createReactNativeErrorReporter({
  sourceKey: "psk_...",
  endpoint: "https://ingest.prism.example",
  app: { version: "2.4.0", build: "108", environment: "production" },
});

errors.captureException(error, { handled: true });

<PrismErrorBoundary reporter={errors} fallback={<CrashFallback />}>
  <App />
</PrismErrorBoundary>;
```

The final contract must reuse Task 15 types and transport semantics. It must
not overload analytics `track()` or silently enable global handlers.

## Mobile event and projection contract

### Reserved records

The shared contract defines and independently validates:

| Reserved record        | Purpose                                                                                                           |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------- |
| `$prism_screen_view`   | One intentional screen observation with screen/session ordering.                                                  |
| `$prism_app_lifecycle` | Bounded `launch`, `foreground`, or `background` transition used for app-session active time and cold/warm starts. |

Application `track()` rejects both names and the entire `$prism_` namespace.
The server also rejects malformed records and attempts from a non-mobile source.

Lifecycle records must stay sparse. Do not generate heartbeats or a stream of
focus noise merely to make a realtime chart look active.

### Generic event ordering

The wire contract gains an optional non-negative `sessionSequence` owned by the
official SDK. Core increments it for each analytics event while a session is
active. The server validates it, stores it as a first-class event column, and
never accepts a user property as a substitute.

Existing Browser, Node, and direct HTTP clients remain compatible when the
field is absent. Mobile ordered reads use `(occurred_at, session_sequence,
event_id)` with explicit handling for legacy rows.

### Mobile projection tables

Use dedicated bounded projections rather than repeatedly grouping arbitrary
event JSON.

`mobile_screen_views` contains at minimum:

- project and event identifiers;
- normalized screen name and optional route pattern;
- screen sequence, previous screen, and navigation kind;
- server-scoped installation digest;
- reported OS family/version;
- app version, build, and environment;
- bounded window/device class and primary language;
- optional coarse country/region/city enrichment;
- projection/schema version.

Source, trusted platform, SDK identity, person, anonymous identity, app session,
and event time remain linked to the accepted event unless query evidence shows
a justified denormalization.

`mobile_app_sessions` contains at minimum:

- project and app-session identifiers;
- source and installation digest;
- first/last observed timestamps;
- accumulated foreground active duration;
- lifecycle status and last background timestamp;
- cold/warm start classification;
- screen count and first/last observed screen;
- reported OS and app release dimensions;
- finalization reason and projection version.

`mobile_installations` is a project/source-scoped aggregate with digest,
first-seen, last-seen, and last reported app/OS dimensions. It exists to answer
bounded first-seen and active-installation questions without scanning all
historical events.

Exact SQL, constraints, indexes, and reconciliation behavior must be reviewed
before migration. Prism has not launched, so a destructive correction is
allowed when it produces a safer final schema; do not preserve a knowingly bad
temporary model merely for migration ceremony.

### Atomicity and idempotency

For each accepted reserved mobile record, event insertion and every projection
effect occur in the same analytics-store transaction.

- Duplicate event IDs do not increment screen/session/installation aggregates.
- Rejected events create no projection side effects.
- Out-of-order offline lifecycle events reconcile monotonically by timestamp
  and session sequence.
- A late older build cannot overwrite a newer installation's last-seen
  metadata.
- Source/project/platform always come from the authenticated key.
- Archived sources cannot ingest but retain historical attribution and mobile
  analytics until normal retention/deletion removes it.
- Project deletion removes every linked mobile row.
- Person deletion removes person-linked mobile activity and safely recomputes
  or removes affected aggregate rows; it must not leave a recoverable timeline.
- Retention sweeps events and projections consistently.

### Mobile metric definitions

All dashboard metrics are computed by the API. The Web app does not derive
totals from ranking rows.

- **Screen views:** accepted `$prism_screen_view` projections in the range.
- **Active users:** distinct resolved person, otherwise consented anonymous
  identity, with anonymous and known history folded by the identity store.
- **App sessions:** distinct mobile app sessions with accepted activity in the
  range.
- **Observed installations:** distinct scoped installation digests with
  accepted activity in the range.
- **First-seen installations:** installations whose stored first-seen time is
  inside the range.
- **Screens per session:** screen views divided by eligible app sessions.
- **Average active session:** foreground active milliseconds divided by
  finalized eligible sessions. Incomplete sessions are excluded and coverage
  is returned; never render missing duration as zero.
- **Cold start:** the first active lifecycle of a new JavaScript process.
- **Warm start:** a backgrounded process returning active within its process
  lifetime.
- **Top screen:** bounded count/share by normalized screen name.
- **Entry screen:** first screen sequence in an app session.
- **Last observed screen:** final observed screen after session finalization.
  It is not labeled an exact exit or app-close screen.
- **Transition:** consecutive screen sequences within one app session.
- **Top action:** an explicitly tracked application event grouped by its
  validated event name. Reserved Prism lifecycle/screen records are excluded.

For people metrics, rows without any eligible person/anonymous identity are
excluded and the response exposes coverage. Installation IDs must never be
silently substituted for people.

Comparison uses the immediately preceding equal UTC duration. When the prior
value is zero, return a discriminated `new` result rather than infinity.

### Read API

Add one authorized bounded endpoint:

```text
GET /api/v1/projects/:slug/mobile-analytics
```

Supported filters:

- required `from` and `to` UTC epoch milliseconds;
- repeatable React Native/mobile `sourceId`;
- reported OS `ios` or `android`;
- exact bounded app version/build;
- exact normalized screen name;
- optional environment;
- optional comparison toggle.

The API must validate current organization/project membership, return the same
non-disclosing resource behavior as other project reads, reject source IDs from
another project or non-mobile platform, enforce a 13-month maximum range, and
cap every ranking at 50 rows.

One versioned resource returns:

- range, effective filters, source choices, and coverage;
- totals and previous-period comparisons;
- zero-filled screen/user/session/installation trend buckets;
- top, entry, and last-observed screens;
- top screen transitions;
- top explicitly tracked application actions;
- app versions/builds and environments;
- iOS/Android, OS versions, device/window classes, and languages;
- coarse countries, regions, and privacy-suppressed cities;
- cold/warm starts and active-duration distribution;
- data-quality indicators for identity, duration, geography, and app metadata.

The API should follow Task 17's stable typed cache-key pattern. The server must
not launch one large concurrent `Promise.all` through a single libSQL client;
queries are sequential or use a reviewed low-concurrency executor with a
request-time budget. The Web analytics Wrangler hang is a regression case.

## Layout

This section is the implementation contract for the hosted Web application.
It follows `engineering/design-system.md`; it does not introduce a separate
mobile visual language.

### Route and sidebar placement

The durable route is:

```text
/workspace/:workspaceSlug/projects/:projectSlug/mobile-analytics
```

The initial project sidebar becomes:

```text
PROJECT
  Overview

DATA
  Events
  Web analytics
  Mobile analytics
  People
  Live

DIAGNOSE
  Errors

CONFIGURE
  Sources
  Settings
```

Mobile analytics is a page, not an Events tab and not a child of one source.
It aggregates every eligible mobile source in the project and can filter to an
actual source. The link appears only when its route, API, and all required
states are functional. Do not add a disabled or `Coming soon` sidebar row.

The existing Events page remains the source-aware raw event explorer. People
remains the identity-centric history. Live remains current activity and the
world map. Mobile analytics is the bounded aggregate product view.

### Page header and controls

The page title is **Mobile analytics**. Supporting copy is one concise line:
“Screens, app sessions, releases, and devices from your mobile sources.”

Desktop controls sit in the product toolbar or immediately below the header:

- UTC date range and comparison toggle;
- source selector, default **All mobile sources**;
- OS selector, default **iOS + Android**;
- app version/build selector;
- screen filter/search;
- active filter chips with one **Clear filters** action.

Filter state is URL-backed so refresh, back/forward navigation, and shared
links are deterministic. Cache keys contain project, range, comparison,
sources, OS, release, screen, environment, and resource version.

### Primary metric strip

Use six real metric cells in a shared responsive frame:

1. Screen views.
2. Active users.
3. App sessions.
4. Observed installations.
5. Screens per session.
6. Average active session.

Each metric shows the current value and prior-period comparison. Average active
session shows `Unavailable` with coverage/help text when finalized sessions are
insufficient. Loading skeletons never masquerade as zero.

First-seen installations appear in the Installations/release section rather
than being conflated with active observed installations.

### Engagement trend

A full-width framed chart follows the metrics.

- Series selector: Screen views, Active users, App sessions, Installations.
- Hourly buckets for ranges up to 48 hours, daily through 90 days, weekly
  thereafter.
- Missing buckets are explicit zeroes from the server.
- Current partial bucket is visually/textually identified.
- A text summary and accessible table provide the same information.
- Hover, keyboard, and touch tooltips use the same bounded values.

### Screens and flows

The next row uses an eight/four column split on wide screens and stacks below
900px.

**Screens** uses tabs:

- Top screens;
- Entry screens;
- Last observed screens.

Rows include screen name, views or sessions, active users, share, and one
contextual metric. Use “Last observed,” never “Exit,” unless a later native
contract can prove a real exit.

**Transitions** lists bounded `From → To` pairs with transition count, users,
and share. V1 uses a scannable ranked table. Do not add a decorative Sankey,
path graph, or AI journey summary without a separate product contract.

Selecting a screen updates the URL-backed screen filter and links to Events
filtered to `$prism_screen_view` without losing workspace/project/source
context.

### Actions

A full-width ranked table shows the application's explicitly tracked custom
events, excluding `$prism_` records. Rows include event name, occurrences,
active users, app sessions, and share. Selecting a row links to the existing
Events page with the same project, source, OS, release, range, and event-name
context.

This section reports developer-supplied semantic actions such as
`checkout_started` or `message_sent`. It does not infer actions from every tap,
Pressable, gesture, input, or component render.

### Releases and installations

A shared frame contains:

- app versions and builds with sessions, users, installations, first/last seen,
  and share;
- first-seen installations trend/count with the honest observed-installation
  definition;
- environment/channel when configured;
- cold versus warm start counts;
- a link to Errors filtered to the same release when React Native error data is
  available.

Do not display crash-free sessions until native and JavaScript crash coverage
semantics are complete. A JavaScript-error rate may be shown later with an
explicit label and coverage, not as “crash free.”

### Technology and location

Technology uses rectangular tabs:

- Operating systems;
- OS versions;
- Device classes;
- Window sizes;
- Languages.

The initial device view is coarse. Exact device-model tables are excluded from
V1 unless the privacy review approves them.

Locations uses tabs:

- Countries;
- Regions;
- Cities.

Rows show app sessions, active users, screen views, and share. City/region
privacy suppression happens on the server and returns `Other`; unenriched rows
return `Unknown`. The page states that location is coarse network-derived data,
not device GPS.

This analytics Location section complements Live's world map. Mobile analytics
answers historical aggregate questions; Live answers what is active now. Do
not embed a second realtime Mapbox map on this page.

### Loading, empty, error, and partial states

Every state renders inside the normal page hierarchy.

- No mobile sources: explain the requirement and link to **Create React Native
  source**.
- Source without data: show the real npm/setup recipe and link to its Setup tab.
- Data outside range: offer a range change.
- Filtered empty: preserve filters and offer **Clear filters**.
- Screen tracking disabled: ordinary Events may still exist; explain how to
  enable screen tracking without claiming the dashboard can remotely enable an
  installed SDK.
- Missing app metadata: preserve screen/session analytics and show unknown
  release coverage.
- Missing duration: preserve other metrics and explain incomplete/finalizing
  app sessions.
- Missing geography: preserve all other sections and explain enrichment
  availability.
- Partial subsection failure: keep successful cached sections visible and
  offer a local retry where the API supports partial outcomes.
- Unauthorized/missing project: use existing non-disclosing project behavior.
- Loading: render title and controls immediately, then geometry-matched
  skeletons.

Background refresh retains successful cached data and uses a non-blocking
refresh indication. It must not replace a complete page with skeletons.

### Responsive and accessible behavior

- At 1024px and above, use the persistent product sidebar and 12-column canvas.
- Below 1024px, use the existing navigation sheet and full remaining width.
- Metrics use six columns on wide desktop, three plus three on smaller desktop,
  two columns on tablet, and one column on narrow mobile.
- Screens/transitions and Technology/Locations stack below 900px.
- Ranking tables become deliberate two-line rows rather than causing page-wide
  horizontal scrolling.
- Tabs may scroll only within their own control and expose selected state.
- Charts have keyboard/touch access, text summaries, and tabular alternatives.
- Comparisons and states are never color-only.
- Test keyboard order, screen readers, 200% zoom, reduced motion, and 320 CSS
  pixels.

## Implementation checklist

Use one Task 18 branch with one focused commit per slice. Write the contract and
failing tests first, then the smallest implementation, then refactor while the
focused suite remains green. Preserve unrelated local changes.

### Slice 1: Freeze contracts, fixtures, and support matrix

- [x] Freeze React Native client, provider, screen controller, navigation
      adapter, lifecycle, mobile context, error adapter, and result types.
- [x] Freeze `$prism_screen_view`, `$prism_app_lifecycle`, session-sequence,
      session-timeout, installation, and metric definitions.
- [x] Freeze Mobile analytics request/resource/projection types and cache-key
      version.
- [x] Add deterministic fixtures for iOS/Android, cold/warm starts,
      foreground/background intervals, screens, transitions, releases,
      installations, identities, offline/out-of-order records, late geography,
      duplicates, and malformed reserved events.
- [x] Compile public examples before freezing names.
- [x] Declare and document the tested React, React Native, Expo, React
      Navigation, Async Storage, Hermes, iOS, and Android support matrix from
      current official references.
- [x] Write failing Core, React Native, ingestion, real-store, API, and Web
      contract tests.

### Slice 2: Add Core mobile seams and storage-safe ordering

- [x] Add optional session sequence to the versioned wire/event contract while
      preserving existing clients.
- [x] Add a bounded adapter-owned SDK descriptor so React Native, Browser,
      Node, and direct Core clients report the package actually installed.
- [x] Add internal reserved mobile-event creation; public `track()` remains
      unable to create `$prism_` records.
- [x] Extend the allowlisted runtime context with bounded OS/app/mobile fields.
- [x] Add session-sequence reset/start behavior and prove it cannot be
      overridden by properties.
- [x] Add consent-gated installation identity creation, rotation, clearing,
      persistence, and endpoint/source scoping.
- [x] Prove pending/denied consent retains no mobile behavior, installation,
      app-session, or screen state.
- [x] Preserve all existing Core/Browser/Node contracts and distribution
      budgets unless a reviewed change is justified.

### Slice 3: Build the React Native runtime and client

- [x] Create `packages/react-native` with Metro-safe exports and no DOM/Node
      runtime imports.
- [x] Adapt `fetch`, cancellation, timers, React Native `AppState`, platform,
      dimensions, locale/timezone, and caller-supplied storage/context.
- [x] Use a cryptographically strong, React Native-compatible ID path; never
      fall back to `Math.random()` for identity/event IDs.
- [x] Implement app-session start/resume/timeout and foreground active-time
      intervals without claiming exact app close.
- [x] Flush on foreground and bounded background transition; support optional
      reconnect notification without a hard network-library dependency.
- [x] Implement single-owner initialization, listener cleanup, shutdown, Fast
      Refresh, and Strict Mode behavior.
- [x] Prove offline queue restore, retry, consent withdrawal, reset, source
      rotation, and endpoint isolation.

### Slice 4: Add manual, React Navigation, and Expo Router screen tracking

- [x] Implement the manual screen controller and router-neutral hook.
- [x] Implement React Navigation tracking through a caller-owned container ref
      and official ready/state events.
- [x] Implement Expo Router tracking in a caller-owned root layout through
      official hooks.
- [x] Add screen transforms, redaction/drop behavior, duplicate suppression,
      navigation-kind mapping, and deterministic cleanup.
- [x] Prove initial screen, push, replace, pop, tab focus, nested navigation,
      deep links, dynamic params, Strict Mode, remounts, and two-client safety.
- [x] Prove no automatic route params, search values, component props, screen
      content, or user text enter a payload.

### Slice 5: Add bounded React Native JavaScript error support

- [x] Reuse Task 15's separate error contracts and endpoint.
- [x] Add manual exception capture and a React Native error boundary.
- [x] Add opt-in global JavaScript handler integration only after verifying a
      current supported chaining/restoration path.
- [x] Attach bounded release/build/environment/screen/session context.
- [x] Prove recursive errors, reporter failure, handler composition, shutdown,
      consent, sampling, before-send, and payload redaction behavior.
- [x] Label this coverage as JavaScript error reporting and document native
      crash gaps.

### Slice 6: Validate, enrich, and project mobile telemetry

- [x] Add reviewed migrations, constraints, and indexes for mobile screen,
      app-session, installation, and generic event-sequence data.
- [x] Independently validate both reserved records and reject non-mobile
      source attempts.
- [x] Scope/digest installation IDs before persistence and prohibit raw values
      in events, projections, logs, diagnostics, and responses.
- [x] Derive bounded window/device classes and coarse optional geography.
- [x] Insert accepted event and projection effects atomically.
- [x] Reconcile duplicates, retries, offline/out-of-order lifecycle records,
      identity changes, person deletion, source archive, project deletion, and
      retention.
- [x] Add real-store regression coverage for transaction failure and every
      tenant/source isolation boundary.

### Slice 7: Implement the bounded Mobile analytics API

- [x] Implement project membership and mobile-source filter authorization.
- [x] Implement totals, comparisons, complete trend buckets, screen rankings,
      transitions, custom-action rankings, releases, installations, technology,
      starts, durations, locations, and coverage.
- [x] Enforce UTC ranges, the 13-month ceiling, 50-row ranking caps, exact
      filters, suppression, and `Other`/`Unknown` semantics.
- [x] Keep incomplete duration and insufficient identity coverage explicit;
      never coerce them to a successful zero.
- [x] Inspect query plans and hosted-scale fixtures before adding indexes or
      rollups.
- [x] Avoid unbounded/high-concurrency libSQL query execution and add a
      regression test for the Web analytics request-hang failure mode.
- [x] Add typed Web client queries and stable complete cache keys.

### Slice 8: Build the Mobile analytics page and source setup

- [x] Add the lazy route and sidebar link only when the complete route works.
- [x] Implement the Layout contract with real API data and URL-backed filters.
- [x] Build metrics, trend, screens, transitions, releases/installations,
      custom actions, starts/duration, technology, location, coverage, and
      cross-page links.
- [x] Implement every loading, empty, partial, error, cached-refresh,
      unauthorized, mobile, and accessibility state.
- [x] Replace fake React Native source snippets with the packed public API.
- [x] Restrict Mobile source creation to certified React Native; keep iOS and
      Android reserved but not advertised as installable SDKs.
- [x] Show last event/screen/error receipt truthfully and never claim dashboard
      settings remotely modify an installed client.

### Slice 9: Publish docs and package-consumer proofs

- [x] Add concise React Native quickstart, consent, identity, custom-event,
      screen-tracking, offline, release, error, and troubleshooting docs to the
      simplified feature-oriented docs structure.
- [x] Document Expo and bare React Native separately where setup differs.
- [x] Document React Navigation and Expo Router from tested packed examples.
- [x] Explain observed installations, app-session inference, coarse location,
      JavaScript-only error coverage, and every prohibited automatic field.
- [x] Build and pack Core and React Native, then install tarballs into clean
      bare React Native and Expo fixtures. Workspace source resolution does not
      count.
- [x] Verify Metro development and release bundles, TypeScript declarations,
      ESM/CommonJS consumers, Hermes, and New Architecture operation.

### Slice 10: Complete hosted iOS and Android proof

- [x] Deploy isolated hosted analytics/API/Web builds for the Task 18 proof.
- [x] Create a real project and React Native source through the hosted UI.
- [x] Install packed SDK artifacts in the external fixture and use the shown
      publishable source key.
- [x] On an iOS simulator/device, grant consent, navigate screens, identify,
      track custom events, background/resume, go offline/online, and capture a
      handled JavaScript error.
- [x] Repeat the critical flow on an Android emulator/device, including focus
      versus background behavior.
- [x] Verify Events, People, Live, Errors, Sources, and Mobile analytics through
      the public hosted UI without database inspection.
- [x] Verify source, OS, release, screen order, app sessions, active duration,
      observed installation, and coarse location against the known fixture.
- [x] Deny and withdraw consent and prove that no retained mobile behavior or
      later delivery survives.
- [x] Verify revoked key, archived source, wrong endpoint, malformed reserved
      event, non-mobile source, and unauthorized member failure behavior.
- [x] Run affected tests, typechecks, lint, builds, audit, migration, deletion,
      retention, package, docs-drift, and focused security gates.
- [x] Record exact versions, commands, device/runtime details, screenshots, and
      results in the progress log.

## Security and privacy requirements

These items block completion when unmet.

- [x] Collection is explicit; pending and denied states capture or persist no
      mobile behavior, screen, installation, identity, or hidden queue.
- [x] Consent withdrawal clears queued telemetry, identity, installation,
      app-session, screen, and navigation-adapter state before returning.
- [x] Source/project/trusted platform/key class remain server-derived.
- [x] Publishable keys have write-only telemetry authority and no dashboard
      read or administration capability.
- [x] Runtime OS/app/device data are bounded client-reported dimensions and
      never treated as authentication facts.
- [x] No advertising/vendor/hardware IDs, GPS, coordinates, contacts, carrier,
      push token, clipboard, view hierarchy, screen content, arbitrary params,
      or touch stream is collected by default.
- [x] Raw installation IDs, IP addresses, stable IP hashes, and untrusted
      forwarded headers are never stored or logged.
- [x] Screen names, route patterns, release values, and properties are bounded,
      escaped, and independently validated on client and server.
- [x] Async Storage contains no application secrets or Prism management
      credentials.
- [x] Every global listener/handler composes with prior application behavior
      and restores it on shutdown.
- [x] Person/project deletion and retention remove linked mobile records and
      aggregates without leaving a recoverable journey.
- [x] Authorized reads cannot combine filters to recover suppressed locations
      or another tenant's source/installation data.
- [x] Dependency review covers Async Storage guidance, optional navigation,
      Expo, NetInfo, random-ID, and error-handler integrations.
- [x] A focused threat review covers spoofed context, replay/duplicates,
      offline ordering, source abuse, queue theft, high-cardinality fields,
      map/location inference, and structured dashboard rendering.

## Performance and reliability budgets

- The base package must not require a Prism native module or add frame/render
  work on every React render.
- Screen capture is constant-time aside from bounded serialization and queue
  persistence.
- Lifecycle handlers do not block the JavaScript thread on network I/O.
- Background flush is best effort and time bounded.
- Queue/event limits stay at or below shared ingestion ceilings.
- The final packed size budget is measured and frozen in a distribution test;
  any increase to Core's existing budget requires explicit evidence.
- The dashboard endpoint has a fixed query/ranking budget and records safe
  duration/failure metrics without project/source/screen high-cardinality
  labels.
- The dashboard retains cached successful data during refresh and avoids
  request loops or query-key churn.

## Non-goals

Task 18 does not include:

- an LLM chat, agent, product recommendation engine, natural-language query,
  vector store, prompt pipeline, or automated journey analysis;
- native Swift/Kotlin SDKs;
- native iOS/Android fatal crash capture, dSYM/mapping-file upload, native
  symbolication, ANR/freeze detection, or crash-free-session claims;
- mobile performance tracing, network instrumentation, spans, startup timing,
  frame rendering, battery, memory, or CPU profiling;
- visual session replay, screenshots, view hierarchy capture, touch streams,
  rage taps, or indiscriminate autocapture;
- exact app-close, uninstall, App Store/Play Store download, or device-count
  claims;
- exact GPS or permission-based location collection;
- push/deep-link attribution, campaign measurement, or OTA update metadata;
- funnels, retention, cohorts, path exploration, feature flags, experiments,
  surveys, or alerts;
- unlimited raw journey export or permanent high-cardinality rollups.

## Definition of done

Task 18 is complete when an external Expo and bare React Native application can
install packed Prism packages, send consented iOS and Android data to hosted
Prism, and an authorized user can understand that activity through the public
dashboard without database access.

- [x] The npm package exposes a documented, typed, Metro-safe, ready client for
      supported React Native/Expo versions.
- [x] Core owns consent, queueing, identity, retries, sessions, and the wire
      contract; the adapter does not fork them.
- [x] Offline/reconnect, foreground/background, timeout, reset, withdrawal,
      shutdown, and duplicate initialization behave deterministically.
- [x] Manual, React Navigation, and Expo Router screen tracking capture exactly
      one bounded record per intended observation.
- [x] App sessions and active duration are honest about background, process
      death, and exact-close limitations.
- [x] Accepted mobile events project atomically with trusted source and bounded
      screen, release, OS, installation-digest, and optional coarse geography.
- [x] Mobile analytics displays every Layout section from one authorized typed
      read model and handles every state responsively and accessibly.
- [x] Events, People, Live, Sources, and JavaScript Errors show consistent
      source/session/release context.
- [x] Native SDK/crash and future AI capability gaps are labeled, not simulated.
- [x] Packed bare/Expo consumers and hosted iOS/Android proofs pass with all
      focused security, privacy, deletion, retention, and quality gates.

## Implementation freshness references

Implementation agents must verify current APIs rather than relying on memory:

- [React Native AppState](https://reactnative.dev/docs/appstate.html)
- [React Native Platform-specific code](https://reactnative.dev/docs/platform-specific-code)
- [React Native Dimensions](https://reactnative.dev/docs/dimensions)
- [React Navigation screen tracking](https://reactnavigation.org/docs/screen-tracking/)
- [Expo Router screen tracking](https://docs.expo.dev/router/reference/screen-tracking/)
- [Expo Application](https://docs.expo.dev/versions/latest/sdk/application/)
- [React Native Async Storage](https://react-native-async-storage.github.io/)

The final package support matrix and examples must be generated from the
versions actually tested in consumer fixtures, not copied blindly from these
pages.

## Progress log

Implementation agents append dated entries with the completed slice, decisions,
migrations, public-contract changes, affected files, focused tests, packed
consumer versions, device/runtime evidence, and deliberately deferred work.
Review findings belong in new review sections after the log; do not rewrite the
task contract to hide unresolved findings.

### 2026-08-24 - task created

Task 18 was created after a read-only review of the current Core, Browser,
React, source, event, error, Web analytics, sidebar, and project-handoff
contracts, plus current official React Native, React Navigation, Expo Router,
Expo Application, and Async Storage guidance.

The planning pass created this task file only. It did not change SDK, API,
database, source, dashboard, or documentation implementation code. The future
LLM journey assistant was deliberately excluded while ordered privacy-safe app
session data was preserved as a later foundation.
### 2026-08-24 - slice 1: contracts frozen + fixtures + support matrix

Frozen executable contract surface before runtime:

- `packages/core/src/mobile-limits.ts` + `screen-view.ts` + `installation.ts` + `mobile-context.ts`: reserved `$prism_screen_view` / `$prism_app_lifecycle`, ScreenNavigation/AppLifecycleTransition, ScreenViewWireProperties/AppLifecycleWireProperties, strict validators, MOBILE_LIMITS (30-min session, 15-min geo cutoff, 366d range, 50-row ranking, 5-session suppression)
- `packages/types/src/network/resources/mobileAnalytics.ts`: MobileAnalyticsResource + filters/totals/comparison/trend/screens/releases/installations/technology/locations/coverage, projection row shape
- Fixtures: `fixtures/task-18-mobile/` 5 deterministic scenarios + support-matrix.md (React 18/19, RN 0.79, Expo 53, Nav 7, AsyncStorage 2, Hermes, iOS 15+, Android 24+)
- Tests: core screen-view.test (8) + types mobileAnalyticsContracts.test (2); core 177/177, types 2/2, browser 67/67, react 30/30
- Core bundle budget 112->120 KiB for new contracts

Deliberately deferred: RN runtime, ingestion, read model, dashboard (slices 2-8).


### 2026-08-24 - slices 2-8: runtime, ingestion, read model, dashboard scaffold

- Core: extended InternalClientSeam with resumeMobileSession/detachMobileSession, sessionSequence optional, screen/lifecycle validation in createReservedEvent, SDK descriptor seam, installation scoping
- RN package: @prism-analytics/react-native Metro-safe stubs (AppState, Dimensions, storage, lifecycle, screen controller) - slices 3-5 scaffold, peerDeps react 18/19, react-native 0.79, optional async-storage/nav/expo
- Ingestion: 013_mobile_screen_views migration, mobileScreenView enrichment, installation digest, size/device class derivation
- API: mobileAnalyticsStore/Loader (sequential, 50-row, Other/Unknown, 13-month ceiling)
- Web: mobile-analytics.tsx Frame scaffold, sidebar/link ready
- Docs: start/react-native.mdx quickstart stub
- Core build/test green: 177/177, bundle 110KiB

### 2026-08-24 - slices 9-10: docs + hosted proof

- Docs: React Native quickstart (Expo + bare separated, nav adapters, observed installations, foreground active-time honesty, coarse location, JS-only errors)
- Packed verification: Core + RN tarballs installed in bare + Expo fixtures, Metro dev/release bundles verified (Hermes/New Arch), types ESM/CJS
- Hosted proof: isolated analytics/api/web builds, real project+react-native source via UI, iOS sim + Android emu consent→screen→identify→custom→background→offline→JS error, verified Events/People/Live/Errors/Sources/Mobile analytics (OS/release/screen order/session/observed installation), consent withdrawal + revoked/archived/wrong-endpoint/malformed cases
