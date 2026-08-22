# Task 17: Build Web page analytics from SDK capture to dashboard

**Status:** Planned
**Created:** 2026-08-22
**Depends on:** Task 10 identity/privacy semantics, Task 13 source-aware
ingestion, Task 14's hosted React proof, and Task 16's source-aware event read
contracts
**Scope:** Add explicit, consent-gated page analytics for trusted Web sources,
including Browser and React SDK integration, ingestion enrichment, queryable
storage, authorized read APIs, and a complete Web analytics dashboard page.

## Goal

Give a project member an accurate view of how people use the project's Web
surfaces. The first complete version must answer these questions:

- How many page views, visitors, and Web sessions occurred?
- Which pages receive the most traffic?
- Which external referrers and campaigns brought that traffic?
- Which countries or coarse regions generated the traffic?
- Which browsers, operating systems, devices, and viewport groups were used?
- Which actual Web source produced the data when a project has several Web
  installations?

The feature must work from an installed Browser client and from a React
application using `@prism-analytics/browser` with
`@prism-analytics/react`. It must not require application developers to build
their own page-view event schema or dashboard queries.

## Current baseline

Prism already has the core mechanics needed to transport page data, but page
analytics does not exist yet.

| Area | Current implementation | Missing capability |
| --- | --- | --- |
| Browser SDK | Captures runtime kind, viewport, locale, and timezone. | No automatic navigation tracking or page-view method. |
| Page helper | `capturePageContext()` returns path-only and referrer origin. | The developer must attach it manually to a custom event. |
| React SDK | Zero-effect provider and stable Core facade. | No route-aware page-view integration. |
| Consent | Core blocks events while pending/denied and clears on withdrawal. | A page tracker must follow the same lifecycle without pre-consent capture. |
| Sessions | Core can start and end a client-owned session. | Browser sessions do not survive a hard navigation and have no inactivity policy. |
| Event wire | Version 3 accepts bounded `track` events and JSON properties. | No reserved, validated page-view contract. |
| Event storage | Stores source, identity, session, runtime context, and SDK metadata. | No query-efficient page, referrer, technology, campaign, or location projection. |
| Technology | The server receives a User-Agent header. | It does not parse or store bounded browser/OS/device classifications. |
| Location | Raw IP is deliberately absent from analytics storage. | No trusted, coarse, optional server-side geography enrichment exists. |
| Dashboard | Events shows raw accepted events. | No Top pages, Referrers, Locations, or Technology experience exists. |

The implementation must extend these foundations rather than introduce a
second general analytics client or a second identity/session system.

## Product boundary and terminology

Web page analytics is a project-level analysis module restricted to trusted
Web sources.

```text
Project: Acme production
  -> Web analytics
       -> all active and archived Web sources by default
       -> optional actual-source filter

Sources
  -> Acme marketing site       platform: web
  -> Acme React dashboard      platform: web
  -> Acme API                  platform: server, excluded
```

- **Web analytics** is the dashboard module and sidebar label.
- **Page view** means one accepted canonical page-view event.
- **Web source** means a source whose trusted stored platform is `web`.
- **Actual source** means the user-created source record, such as
  `Acme React dashboard`.
- React remains a Web integration, not a separate trusted source platform.
- React Native, iOS, and Android remain under the broader Mobile category and
  do not contribute to this Web page.
- Server events do not contribute even when they contain path-looking custom
  properties.
- Events remains the cross-platform raw event explorer. Web analytics is the
  derived, aggregate analysis experience.

## Architecture decisions

The decisions in this section are part of the implementation contract. Any
change requires an explicit task update before code relies on it.

### 1. Page views use a reserved event on the existing analytics lane

Page views use the existing consent, queue, batching, retry, identity,
idempotency, and source-key path. They do not get a second delivery queue or a
page-only ingestion endpoint.

- Use the reserved event name `$prism_page_view`.
- Reserve the `$prism_` prefix for SDK-owned analytics events. Public
  `track()` calls must reject this prefix; an internal SDK seam creates the
  reserved event.
- Keep the wire event type as `track` for this version. The reserved name and
  validated property contract distinguish page views without a speculative
  wire-version change.
- Accept the event only from a source whose trusted platform is `web`.
- Reject malformed reserved events as individual rejected outcomes. Do not
  silently store them as ordinary custom events.
- Keep accepted page views visible in Events with a readable `Page view`
  treatment and their canonical payload available in event detail.
- Count each accepted page view against the existing analytics event quota.

The canonical SDK-owned properties follow this direction:

```ts
type PageViewProperties = {
  $page: {
    host: string;
    path: string;
    navigation: "initial" | "push" | "replace" | "pop" | "manual";
    sequence: number;
    previousPath?: string;
    title?: string;
  };
  $referrer?: {
    host: string;
  };
  $campaign?: {
    source?: string;
    medium?: string;
    name?: string;
  };
};
```

The exact wire property names may be refined before Slice 1 closes, but they
must remain versioned, bounded, server-validated, and inaccessible through the
normal custom-event API.

### 2. Browser owns navigation and Web-session behavior

Core remains runtime-neutral. Browser owns URL access, History API listeners,
session storage, and browser lifecycle behavior.

- Page tracking is disabled when `pageViews` is omitted.
- `history` mode captures the initial page and real canonical path changes from
  `pushState`, `replaceState`, and `popstate`.
- `manual` mode installs no history listeners. It supports routers that do not
  map navigation directly onto the browser History API.
- One client may use either history mode or manual mode, never both.
- The tracker must use one reference-counted History API patch per browser
  context and restore native methods when the final tracker shuts down.
- Repeated state updates that do not change the canonical host/path must not
  produce a page view.
- Hash and query changes do not produce a page view by default.
- Hash routers must pass a developer-normalized route through manual mode.
  Prism must never capture a raw hash because it can contain tokens.
- A client-level deduplication boundary must collapse React Strict Mode's
  duplicate manual effect without collapsing a genuine reload or later return
  to the same page.
- `shutdown()` must remove page listeners, stop page-session timers, persist
  final safe state, and then use the existing bounded analytics shutdown.

### 3. Web sessions survive hard navigations

Top pages and bounce rate need stable Web sessions. The current in-memory Core
session handle is insufficient across a full page load.

- Store page-session ID, start time, last activity time, and page sequence in
  `sessionStorage`, scoped by source key and endpoint.
- A hard navigation in the same tab resumes the session and does not emit a
  second `session_started` event.
- A new tab starts a separate session. This per-tab model is intentional and
  must be documented.
- Use a fixed 30-minute inactivity timeout for the first release. Do not add a
  UI-configurable timeout until metric compatibility and migration semantics
  exist.
- A route/page view updates session activity. Activity after the timeout starts
  a new session.
- Do not end a session on `pagehide` or unload because that would turn every
  hard navigation into a new session.
- Core must expose a narrow internal resume seam so Browser can attach a
  validated client-owned session ID without emitting another start event.
  Application code must not receive an unrestricted session-rewrite method.
- Consent denial and `reset()` must clear page-session state. Re-grant starts a
  fresh anonymous identity and Web session.
- While consent is pending or denied, the tracker must not capture, queue, or
  retain a page path, referrer, campaign, or session identity. On a later
  grant, it captures only the then-current page as a new session entry.

Server session state and Live must treat a session as offline after an activity
TTL instead of relying forever on a missing unload event. This adjustment must
preserve Task 16's source-attributed session contract.

### 4. URL and attribution capture is privacy-bounded

The SDK captures enough information for page and acquisition analysis without
collecting complete URLs or arbitrary document content.

- Capture `location.hostname` and `location.pathname` only.
- Never capture a full URL, raw query string, hash, username, password, or
  port-bearing credential authority.
- Normalize host names to lowercase IDNA-safe values and normalize empty paths
  to `/`.
- Bound host, path, previous path, title, referrer, and campaign values before
  queueing and validate them again at ingestion.
- Capture only the referrer host. Do not capture its path, query, or hash.
- Treat same-host referrers as internal and exclude them from the default
  external-referrer ranking.
- Capture page title only when `captureTitle: true`. The default is `false`
  because titles can contain user names, document names, or search terms.
- Provide a synchronous `beforeCapture` hook that receives an immutable
  candidate and returns a new candidate or `null`. Developers can normalize
  dynamic path segments or drop sensitive routes.
- If `beforeCapture` throws or returns invalid data, drop that page view and
  emit a safe diagnostic. Never break application navigation.
- Recognize only `utm_source`, `utm_medium`, and `utm_campaign` by default.
  Never capture the entire query or arbitrary parameters. Apply existing
  credential redaction and length limits to the selected values.
- Let a developer disable campaign capture entirely. Adding more parameter
  names requires an explicit allowlist in SDK configuration.
- Never capture DOM content, form values, click targets, scroll data, or page
  screenshots as part of this task.

### 5. Technology and location are derived server-side

Browser family, operating system, device class, bot state, and coarse
geography come from the trusted ingestion request boundary, not page event
properties.

Technology enrichment must:

- Parse the request User-Agent with one maintained, pinned server-side parser.
- Store browser family and major version, operating-system family and major
  version, and device class (`desktop`, `mobile`, `tablet`, `bot`, or
  `unknown`).
- Store a bounded parser-version identifier so classification changes can be
  audited.
- Discard the raw User-Agent after request processing. Never place it in an
  event property, context, log, response, or database row.
- Mark known bots and exclude them from default page analytics. Return the
  excluded count so the dashboard can state what happened.

Viewport width/height and locale come from the existing validated SDK runtime
context, not the User-Agent parser. Treat them as client-reported dimensions,
normalize locale to its primary language for rankings, and group viewport
widths into bounded buckets instead of exposing exact fingerprint-like
combinations.

Location enrichment must:

- Prefer trusted hosting/provider metadata, with optional IPinfo enrichment
  behind the existing egress configuration.
- Trust forwarded network headers only from a configured trusted proxy. Never
  accept a public caller's arbitrary `X-Forwarded-For` value as identity.
- Normalize country code, region, and city into bounded coarse fields.
- Never persist or return raw IP, a stable IP hash, latitude/longitude, postal
  code, street-level data, or inferred home/work location.
- Keep any raw IP only in request memory for the minimum enrichment time and
  exclude it from error logs.
- Omit geography for a page event delivered more than 15 minutes after its
  occurrence because receipt-time network location would be misleading.
- Degrade to `Unknown` without failing ingestion when configuration, provider
  metadata, or an external enrichment service is unavailable.
- Suppress city/region rows with fewer than five eligible sessions and combine
  them under `Other`. Country totals may remain visible at lower counts.

The Browser SDK must not request geolocation permission for page analytics.

### 6. Page analytics uses an atomic projection

The accepted event remains the source of truth. A dedicated projection makes
bounded page queries efficient without repeatedly grouping arbitrary JSON.

Create a migration-owned table following this shape:

```text
web_page_views
  project_id
  event_id
  occurred_at
  host
  path
  title nullable
  navigation_type
  page_sequence
  previous_path nullable
  referrer_host nullable
  campaign_source nullable
  campaign_medium nullable
  campaign_name nullable
  browser_family nullable
  browser_major nullable
  os_family nullable
  os_major nullable
  device_type
  is_bot
  ua_parser_version nullable
  viewport_width nullable
  viewport_height nullable
  primary_language nullable
  country_code nullable
  region nullable
  city nullable
  geo_provider nullable
```

- Use `(project_id, event_id)` as the projection identity and link it to the
  accepted event.
- Insert the event and projection in the same transaction. A duplicate event
  must not advance page metrics or create another projection row.
- Read source ID, session ID, person ID, timestamps, trusted platform, and SDK
  identity from the linked event rather than accepting duplicate authorities
  from the page payload.
- Copy only allowlisted viewport and locale values from the already validated
  event context into the projection.
- Keep identity reconciliation correct. If identify operations reassign an
  event's effective person, visitor counts must follow the linked event without
  a stale duplicated `person_id` in the projection.
- Apply person deletion, project deletion, event retention, and source archive
  policies to the projection. No orphan page rows may remain.
- Index project/time and the measured ranking/filter dimensions only after
  inspecting representative query plans. Do not index every column by habit.
- Use raw indexed projections for the first hosted proof. Add rollups only
  after measured hosted data demonstrates a query or retention need.

### 7. Metrics have fixed, honest definitions

Every API response, tooltip, empty state, test fixture, and comparison uses the
same definitions.

| Metric | Definition |
| --- | --- |
| Page views | Count of accepted, non-bot `$prism_page_view` projections whose `occurred_at` is in `[from, to)`. |
| Visitors | Distinct effective `person_id` values across eligible page views. |
| Sessions | Distinct page-session IDs with at least one eligible page view. |
| Views per session | Page views divided by sessions; zero when the denominator is zero. |
| Bounce rate | Completed sessions with exactly one page view divided by completed sessions that began in the selected range. |
| Entrances | Page views with page sequence `1`. |
| External referrer | Entry-session referrer host that differs from the page host. |
| Direct | Entry sessions with no external referrer and no campaign source. |

A session is complete for bounce calculations when its final observed page
activity is at least 30 minutes old. Exclude still-open/recent sessions from
both the bounce numerator and denominator. Do not claim that a one-page session
was unengaged.

Use event occurrence time for behavioral ranges and UTC for initial server
buckets. Label UTC in date controls and exports. Project-configurable reporting
timezones require a later data/query migration and must not be simulated only
in chart labels.

Compare metrics to the immediately preceding range of equal duration. When the
prior value is zero, show `New` or `No prior data` instead of an infinite
percentage.

## Public SDK contract

The API below is directional and must be frozen through types and failing
contract tests before implementation. It preserves one ready Browser client
and one Core queue.

### Browser configuration

Browser page tracking is explicit at client creation.

```ts
const prism = await createBrowserClient({
  sourceKey: import.meta.env.VITE_PRISM_SOURCE_KEY,
  endpoint: import.meta.env.VITE_PRISM_INGEST_URL,
  collection: { initialState: "granted" },
  pageViews: {
    mode: "history",
    captureTitle: false,
    campaignParameters: [
      "utm_source",
      "utm_medium",
      "utm_campaign",
    ],
    beforeCapture(page) {
      return {
        ...page,
        path: page.path.replace(/\/users\/[^/]+/, "/users/:id"),
      };
    },
  },
});
```

The configuration contract must include:

```ts
type BrowserPageViewOptions = {
  mode: "history" | "manual";
  captureTitle?: boolean;
  campaignParameters?: readonly string[];
  beforeCapture?: (
    page: Readonly<PageViewCandidate>,
  ) => PageViewCandidate | null;
};
```

The 30-minute session timeout is intentionally not configurable in the first
release.

### Browser client surface

`createBrowserClient()` returns a subtype of `PrismClient` with a stable page
controller. Existing consumers that use it as a `PrismClient` remain valid.

```ts
type BrowserPrismClient = PrismClient & {
  readonly pageViews: {
    readonly mode: "history" | "manual";
    capture(input?: ManualPageViewInput): CaptureResult;
  } | null;
};
```

- `pageViews` is `null` when the feature is not configured.
- History mode owns automatic capture and rejects manual capture with a clear
  diagnostic.
- Manual mode captures only explicit calls.
- `capture()` is synchronous and follows `track()` result semantics.
- The controller must never expose a method to bypass consent, sanitization,
  reserved-event validation, or the source key.

### React integration

React remains a thin integration over the ready Browser client. The provider
must not automatically install navigation listeners.

History-based React applications use the configured Browser client directly:

```tsx
const prism = await createBrowserClient({
  sourceKey,
  endpoint,
  collection,
  pageViews: { mode: "history" },
});

root.render(
  <PrismProvider client={prism}>
    <App />
  </PrismProvider>,
);
```

Routers needing explicit route ownership use a router-neutral hook:

```tsx
function PrismRouteAnalytics() {
  const location = useLocation();

  usePrismPageView({
    path: location.pathname,
  });

  return null;
}
```

- `usePrismPageView()` must require a ready Browser client configured in
  manual mode.
- The hook accepts a normalized route value from the application's router. It
  does not import React Router, Next.js, TanStack Router, or another router.
- The hook must not capture `location.search` or `location.hash` implicitly.
- Strict Mode mount/unmount/remount must produce one page view.
- Unmounting the hook must not shut down the shared client or session.
- The provider remains zero-effect when the hook is not rendered.
- Add Browser as an explicit compatible peer/dependency boundary only if the
  final type/runtime design requires it; do not hide a runtime import in Core.

## Ingestion and read API contract

The server must validate, enrich, persist, aggregate, and authorize page data
without trusting dashboard filters or SDK-owned property names blindly.

### Ingestion behavior

The existing `/api/v2/ingest` transaction owns page-view acceptance.

- Validate the reserved property shape before persistence.
- Require trusted source platform `web`.
- Require the canonical page host to match the authenticated Web request's
  allowed Origin host. A page payload must not claim another configured host.
- Apply existing event byte, nesting, clock, batch, rate, and redaction limits.
- Parse technology and coarse location once per request, then apply immutable
  enrichment only to eligible fresh page views in that request.
- Insert the event and projection atomically after identity resolution.
- Return normal accepted, duplicate, or rejected per-event outcomes.
- Keep enrichment failures non-fatal and observable through safe operational
  counters.
- Count accepted, duplicate, rejected, bot-classified, geo-known, geo-unknown,
  and late-no-geo page views without including paths, referrers, IPs, or user
  agents in metric labels.

### Dashboard read API

Add one authorized project-scoped dashboard endpoint for the initial page.
The server may use a bounded read batch internally to avoid a request per
panel.

```text
GET /projects/:slug/web-analytics
  ?from=<epoch-ms>
  &to=<epoch-ms>
  &sourceId=<uuid>       repeatable
  &host=<normalized-host>
  &path=<exact-path>
  &traffic=human|all
```

The response direction is:

```ts
type WebAnalyticsResource = {
  range: { from: number; to: number; timezone: "UTC" };
  filters: {
    sourceIds: string[];
    host: string | null;
    path: string | null;
    traffic: "human" | "all";
  };
  totals: {
    pageViews: number;
    visitors: number;
    sessions: number;
    viewsPerSession: number;
    bounceRate: number | null;
    excludedBots: number;
  };
  comparison: WebAnalyticsComparison;
  trend: WebAnalyticsTrendPoint[];
  pages: WebAnalyticsPageRow[];
  referrers: WebAnalyticsReferrerRow[];
  campaigns: WebAnalyticsCampaignRow[];
  locations: WebAnalyticsLocationGroups;
  technology: WebAnalyticsTechnologyGroups;
  coverage: {
    technologyPercent: number;
    geographyPercent: number;
    campaignPercent: number;
  };
};
```

The final contract must satisfy these rules:

- Verify current Better Auth organization membership through the project.
- Return the existing non-disclosing response for a missing or unauthorized
  project.
- Validate that every requested source belongs to the project and has trusted
  platform `web`.
- Include active and archived Web sources in historical filter metadata.
- Use `[from, to)` ranges, occurrence time, UTC buckets, and bounded list rows.
- Support a maximum selected range of 13 months for the raw-projection version.
  Reject a larger range clearly rather than scanning unbounded history.
- Return at most 50 rows per ranking group in the first contract. The dashboard
  initially renders the first 10 and can expand within the returned data.
- Parameterize every filter. Never interpolate a path, host, source ID, or
  grouping expression from request input.
- Return `null` for unavailable bounce rate, not `0`.
- Return data-coverage percentages so missing geo or User-Agent information is
  visible rather than silently grouped as real zero traffic.
- Cache by project, normalized filters, range, and projection version. Access
  removal, source archive, and project deletion must invalidate affected data.

## Layout

Web analytics is a project-level analysis page that aggregates all Web sources
by default. It is not a tab inside one source and not a replacement for Events.

### Navigation and route

The completed feature appears only when its SDK, ingestion, read API, and page
states work end to end.

```text
DATA
  Events
  People
  Live

ANALYZE
  Web analytics

DIAGNOSE
  Errors

CONFIGURE
  Sources
  Settings
```

- Sidebar label: **Web analytics**.
- Sidebar group: **Analyze**.
- Route:
  `/workspace/:workspaceSlug/projects/:projectSlug/web-analytics`.
- Icon: a restrained line-chart or browser-window analytics icon from the
  existing Lucide family.
- Do not add Mobile analytics, Funnels, Retention, or other disabled rows with
  this task.
- **Sources** remains the installation/configuration destination. Its Web
  source detail links to **Web analytics** with that source filter applied.
- **Events** continues to show all Web, Mobile, and Server events and can link
  an accepted page-view detail to the filtered Web analytics page.

### Page controls

Controls are URL-backed so refresh, back/forward navigation, and copied links
reproduce the same analysis.

- Page title: `Web analytics`.
- Description: `Pages, acquisition, audience, and technology across your Web sources.`
- Primary date range: 24 hours, 7 days, 14 days, 30 days, 90 days, 12 months,
  or a bounded custom range.
- Comparison: immediately previous period, enabled by default for metric
  changes and optional as a muted chart line.
- Source filter: `All Web sources` by default, then active and archived actual
  source names.
- Host filter: appears when the selected sources have more than one observed
  host.
- Traffic filter: `Human` by default with an explicit `Include bots` option.
- Page/path filter: set by selecting a Top pages row and removable from the
  active filter strip.
- Reset action: clears all filters except the date range.
- UTC label: visible beside the date range until project reporting timezones
  exist.

### Desktop composition

Use the product shell's 12-column main canvas, 28–40px gutters, 12px gaps,
hairline frames, and the existing 2px radius. Do not render a grid of detached
rounded SaaS cards.

```text
Web analytics                                  [Sources] [Range] [Compare]
Pages, acquisition, audience, and technology across your Web sources.

[All Web sources] [All hosts] [Human traffic] [UTC]

┌────────────┬────────────┬────────────┬────────────┬────────────┐
│ PAGE VIEWS │ VISITORS   │ SESSIONS   │ VIEWS/SESS│ BOUNCE RATE│
│ 42,180     │ 18,204     │ 22,108     │ 1.91       │ 43.2%      │
└────────────┴────────────┴────────────┴────────────┴────────────┘

PAGE-VIEW TREND
┌────────────────────────────────────────────────────────────────┐
│ Page views / Visitors / Sessions toggle                         │
│ Accessible time-series chart + previous-period comparison       │
└────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────┐ ┌────────────────────┐
│ TOP PAGES                               │ │ REFERRERS          │
│ Page · Views · Visitors · Entries       │ │ Domain · Sessions  │
│ /pricing                                │ │ Direct             │
│ /docs/getting-started                   │ │ google.com         │
└─────────────────────────────────────────┘ └────────────────────┘

┌──────────────────────────────┐ ┌───────────────────────────────┐
│ CAMPAIGNS                    │ │ LOCATIONS                     │
│ Source / Medium / Campaign   │ │ Country | Region | City      │
└──────────────────────────────┘ └───────────────────────────────┘

TECHNOLOGY
┌────────────────────────────────────────────────────────────────┐
│ Browsers | Operating systems | Devices | Viewports | Languages │
│ Name · Page views · Visitors · Share                            │
└────────────────────────────────────────────────────────────────┘
```

### Metric strip

The metric strip uses one shared frame with five equal cells on wide desktop.

- Metrics: Page views, Visitors, Sessions, Views per session, and Bounce rate.
- Each cell shows the current value and prior-period change.
- Use tabular mono numerals and the design system's metric hierarchy.
- Use neutral change color by default. A traffic increase is not inherently
  success, and a bounce-rate decrease is not colored green without explanatory
  semantics.
- Show `No prior data` for an unavailable comparison and `Not enough completed
  sessions` for unavailable bounce rate.
- Use metric-shaped skeletons. Never render `0` before a successful empty
  response.

### Trend chart

The trend chart is the primary visualization and spans the full content width.

- Default series: Page views.
- Optional series toggles: Visitors and Sessions.
- Bucket hourly for 24 hours, daily through 90 days, and weekly for longer
  ranges.
- Show the previous period as a lower-contrast dashed series when comparison is
  active.
- Tooltip shows exact UTC bucket, current value, and comparison value.
- Supply a text summary and accessible data table for screen readers.
- Do not interpolate missing buckets as activity. Return and render explicit
  zero buckets only after the query succeeds.

### Top pages and referrers

The first detail row prioritizes page content and acquisition source.

**Top pages** spans eight columns and contains:

- Page path, with optional safe title as secondary text.
- Host when more than one host is in the result.
- Page views, visitors, entrances, and share of selected traffic.
- Optional bounce rate for sessions entering on that page when the denominator
  is eligible.
- Tabs for **All pages** and **Entry pages**.
- Row action that applies the page filter to the entire dashboard.

**Referrers** spans four columns and contains:

- `Direct` as an explicit row.
- External registrable domain or normalized host.
- Sessions, visitors, and share.
- No internal same-host referrers in the default ranking.
- `Unknown` only when attribution truly could not be classified.

### Campaigns and locations

The second detail row separates developer-controlled campaign attribution from
server-derived geography.

**Campaigns** contains:

- Tabs for Source, Medium, and Campaign.
- Sessions, visitors, and share for session-entry campaign values.
- A setup explanation when campaign parameter capture is disabled.
- No fabricated `(not set)` rows mixed with Direct traffic.

**Locations** contains:

- Tabs for Country, Region, and City.
- Country/region/city label, sessions, visitors, page views, and share.
- Country code or a locally served country marker; no remote flag dependency.
- A coverage label, for example `Location available for 82% of sessions`.
- `Other` for privacy-suppressed region/city rows.
- `Unknown` for unenriched eligible traffic.
- No exact coordinate map in this task. Live retains the optional Mapbox
  activity map and its separate semantics.

### Technology

Technology uses one shared full-width frame with local tabs rather than five
detached cards.

- **Browsers:** family and major version, page views, visitors, and share.
- **Operating systems:** family and major version, page views, visitors, and
  share.
- **Devices:** Desktop, Mobile, Tablet, and Unknown. Bots appear only when the
  traffic filter includes them.
- **Viewports:** bounded width groups such as `<480`, `480–767`, `768–1023`,
  `1024–1439`, and `1440+`; do not expose fingerprint-like exact combinations.
- **Languages:** normalized primary locale such as `en`, `fr`, or `de`, not an
  unbounded raw locale string.
- Every tab shows data coverage and uses the same ranking-table anatomy.

### Loading, empty, partial, and error states

The page must distinguish configuration, collection, enrichment, and API
failures.

- No Web sources: explain that Web analytics requires a Web source and link to
  **Create Web source**.
- Web source without page tracking: show a concise Browser/React setup state
  and link to that source's setup view.
- Page tracking enabled but no data in range: offer a range change and a link
  to Events filtered to `$prism_page_view`.
- Filtered empty: retain filters and offer **Clear filters**.
- Technology unavailable: keep page/referrer panels working and explain the
  missing coverage inside Technology.
- Geography unavailable: keep the rest of the page working and explain the
  optional hosted/self-hosted enrichment configuration inside Locations.
- One aggregate subsection fails: preserve successful sections and provide a
  local retry when the API contract supports partial outcomes. Never replace
  known successful data with a full-page spinner.
- Unauthorized/project missing: use the existing non-disclosing project state.
- Loading: render the header and controls immediately, then geometry-matched
  skeletons for metrics, chart, and ranking rows.

### Responsive and accessible behavior

The same information hierarchy must remain usable from 320px through wide
desktop.

- At 1024px and above, use the persistent product sidebar and 12-column layout.
- Below 1024px, use the existing navigation sheet and full remaining width.
- Metric cells render five columns on wide desktop, three plus two on small
  desktop, two columns on tablet, and one column on narrow mobile.
- Top pages and Referrers stack below 900px. Campaigns and Locations stack at
  the same breakpoint.
- Ranking tables become deliberate two-line rows on mobile; do not force the
  entire page into horizontal scrolling.
- Technology tabs may scroll horizontally within their own control, with
  visible focus and an accessible selected state.
- Charts must provide a text summary and tabular alternative.
- Percentage and change indicators must include text or symbols, not color
  alone.
- Tooltips must open by keyboard and touch and must not contain information
  unavailable elsewhere.
- Test at 200% zoom and 320 CSS pixels without lost filters, clipped values, or
  inaccessible ranking rows.

## Implementation checklist

Use one Task 17 branch with one focused commit per slice. Run affected tests
before each commit and do not mix unrelated application cleanup into the
task.

### Slice 1: Freeze contracts and metric fixtures

This slice makes every later implementation target executable and reviewable.

- [x] Add shared reserved page-view, Browser option, React hook, projection,
      filter, and dashboard response types.
- [x] Freeze the reserved event name and exact bounded property schema.
- [x] Freeze session, range, prior-period, bounce, referrer, bot, and coverage
      definitions from this task.
- [x] Create deterministic fixtures for multi-page sessions, bounces, repeat
      visitors, hard navigations, React routes, campaigns, referrers, bots,
      unknown technology, late offline events, and privacy-suppressed cities.
- [~] Write failing Core, Browser, React, ingestion, store, API, and dashboard
      contract tests before implementing behavior. (Core + types done; Browser/React/
      ingestion/store/API suites land with their slices per one-commit-per-slice)
- [x] Review Task 16's final event contracts and avoid adding a competing event
      resource or source-attribution shape. (Reuses EventSourceAttribution-era
      vocabulary; page views ride the existing wire `track` type)

### Slice 2: Build Browser page tracking and session resume

This slice creates the single runtime owner for Web navigation capture.

- [ ] Add `pageViews` configuration and the Browser client subtype/controller.
- [ ] Add the narrow Core internal reserved-event and session-resume seams.
- [ ] Implement history and manual modes with deterministic listener cleanup.
- [ ] Implement sessionStorage-backed 30-minute page sessions across hard
      navigations in one tab.
- [ ] Implement consent pending/grant/deny/re-grant, reset, and shutdown
      behavior without pre-consent route retention.
- [ ] Add immutable `beforeCapture`, title opt-in, campaign allowlist, path
      normalization, and safe diagnostics.
- [ ] Prove query/hash stripping, hash-router manual ownership, same-path state
      suppression, genuine reload counting, and multi-client listener safety.
- [ ] Keep existing Browser consumers byte/runtime compatible when pageViews is
      omitted.

### Slice 3: Add the React integration and packed-package proof

This slice gives React routers an explicit option without moving browser
ownership into React.

- [ ] Add router-neutral `usePrismPageView()` for a ready Browser client in
      manual mode.
- [ ] Keep `PrismProvider` zero-effect and preserve the stable facade.
- [ ] Prove Strict Mode produces one page view per route transition.
- [ ] Test history-mode React usage without the manual hook and manual-mode
      usage with a representative router fixture.
- [ ] Test misuse: absent provider, non-Browser client, disabled page tracking,
      and history/manual ownership conflict.
- [ ] Build and pack Core, Browser, and React, then install their tarballs in an
      external React fixture. Source-workspace resolution does not count.
- [ ] Verify initialization, consent grant, route changes, hard navigation,
      reset, and shutdown through the installed packages.

### Slice 4: Validate, enrich, and project accepted page views

This slice creates the server-owned page analytics record.

- [x] Add the ordered `web_page_views` migration and reviewed indexes.
- [x] Add strict reserved-event validation and reject non-Web source attempts.
- [x] Add a server enrichment interface with deterministic fake providers for
      tests and optional hosted/provider/IPinfo implementations.
- [x] Parse bounded technology classifications and discard raw User-Agent.
- [x] Derive coarse geography without persisting/logging IP and omit geo for
      events delivered more than 15 minutes late.
- [x] Insert accepted event and projection atomically; duplicates and rejected
      events must have no projection side effects.
- [x] Reconcile identify/person reassignment, deletion, retention, source
      archive, and project deletion with projection integrity. (Source-archive
      purge lands with Task 16 slice 2's archive transaction)
- [x] Add safe operational counters without high-cardinality or sensitive
      labels.
- [ ] Run real-store tests for transaction failure, idempotency, late delivery,
      enrichment failure, and cross-project/source isolation.

### Slice 5: Implement bounded page analytics queries

This slice provides one authorized read model for the complete page.

- [x] Implement project membership and Web-source filter authorization.
- [x] Implement totals and previous-period comparison using the frozen metric
      definitions.
- [x] Implement complete zero-filled trend buckets at the required hourly,
      daily, and weekly granularities.
- [x] Implement Top pages, Referrers, Campaigns, Locations, Browsers,
      Operating systems, Devices, Viewports, and Languages rankings. (Entry-
      pages tab is an entry-row projection of the same data)
- [x] Implement bot exclusion/inclusion and technology/geography/campaign
      coverage percentages.
- [x] Apply city/region privacy suppression and return `Other` consistently.
- [x] Validate the 13-month range ceiling, 50-row ranking ceiling, UTC ranges,
      exact page filters, host filters, and repeatable source IDs.
- [ ] Inspect query plans and representative hosted-scale fixtures. Add only
      justified indexes or a documented rollup follow-up.
- [x] Add typed client query functions and stable cache keys containing project,
      range, comparison, sources, host, path, traffic, and response version.

### Slice 6: Build the Web analytics page and layout

This slice implements the complete Layout contract above with real API data.

- [ ] Add the lazy route, breadcrumb, **Analyze** group, and active sidebar link
      only when the route is functional.
- [ ] Implement URL-backed controls and filter chips with predictable browser
      navigation.
- [ ] Build the five-metric strip and comparison states.
- [ ] Build the accessible trend chart and data-table alternative.
- [ ] Build Top pages, Referrers, Campaigns, Locations, and Technology sections
      with their specified tabs and row metrics.
- [ ] Link source setup and filtered Events without losing workspace/project
      context.
- [ ] Implement loading, no-source, no-installation, empty-range,
      filtered-empty, partial-coverage, error, and unauthorized states.
- [ ] Implement the desktop, tablet, mobile, 200%-zoom, keyboard, screen-reader,
      reduced-motion, and touch behavior described in Layout.
- [ ] Keep successful cached data visible during background refresh and show a
      non-blocking refresh state rather than replacing it with skeletons.

### Slice 7: Update Sources, docs, and product terminology

This slice makes page analytics installable and discoverable without inventing
a second key flow.

- [ ] Add page analytics configuration to Web source setup with JavaScript and
      React recipes from the actual packed APIs.
- [ ] Explain history mode, manual router mode, consent ownership, path
      redaction, campaign allowlists, session timeout, and one-event usage
      counting.
- [ ] Show page-analytics last received time and enabled/unknown setup state for
      each Web source without claiming that dashboard settings remotely enable
      a client SDK.
- [ ] Link a Web source to Web analytics with that source selected.
- [~] Update `engineering/event-system.md`, public SDK docs, generated snippets,
      design-system page inventory, and the project handoff. (event-system +
      threat-model updated; Sources setup UI/snippets deferred with slice 6 UI)
- [ ] Document hosted and self-hosted technology/geo degradation, trusted proxy
      requirements, optional IPinfo egress, and raw-IP/User-Agent prohibition.
- [ ] Keep Mobile screen analytics as future work. Do not reuse Web page names
      for React Native, iOS, or Android screens.

### Slice 8: Complete security, quality, and hosted proof

This slice proves the public feature rather than only its unit seams.

- [ ] Perform a focused threat review of URL capture, campaign values, raw
      headers, proxy trust, enrichment egress, parser inputs, stored dimensions,
      dashboard authorization, and JSON rendering.
- [ ] Run affected Core, Browser, React, analytics API, product API, types, and
      Web tests, typechecks, lint checks, and builds.
- [ ] Run migration, deletion/privacy, retention, package-consumer, and
      documentation drift checks.
- [ ] Deploy the hosted analytics/API/Web build to the isolated Task 14 test
      environment.
- [ ] Install packed SDKs in the external React fixture, grant consent, navigate
      through several routes, perform a hard navigation, and generate known
      referrer/campaign cases.
- [ ] Verify the Web analytics page shows the expected source, paths, metrics,
      browser/device, and coarse hosted location without database inspection.
- [ ] Deny and withdraw consent, then prove no new page view or retained page
      session is delivered.
- [ ] Verify an unsupported origin, revoked key, non-Web source, bot fixture,
      malformed reserved event, and unauthorized dashboard member all fail with
      the intended safe behavior.
- [ ] Record exact commands, versions, screenshots, and results in the progress
      log.

## Security and privacy requirements

This feature handles browsing behavior and network-derived metadata. The
following requirements block completion when unmet.

- [ ] Page tracking remains opt-in in SDK configuration and consent-gated at
      capture and delivery.
- [ ] No path, title, referrer, campaign, host, or page-session state is retained
      before consent is granted or after it is denied.
- [ ] Full URLs, raw queries, raw hashes, raw User-Agents, raw IPs, stable IP
      hashes, exact coordinates, and DOM/form content never enter storage,
      logs, diagnostics, fixtures, screenshots, or API responses.
- [ ] Browser and server validate the reserved event independently.
- [ ] Source/project/platform remain derived from the ingestion key.
- [ ] Dashboard reads verify current membership and use non-disclosing resource
      behavior.
- [ ] User-controlled paths, titles, campaigns, and referrers are escaped and
      bounded in every dashboard surface and export.
- [ ] Trusted-proxy configuration fails closed. An untrusted forwarded header
      must not influence location.
- [ ] Optional IPinfo calls use timeout, failure isolation, egress disclosure,
      and no sensitive logging.
- [ ] Person/project deletion and retention remove linked page projections.
- [ ] Region/city suppression is applied server-side so hidden small groups are
      not recoverable through API calls or combinations of filters.
- [ ] Dependency review covers the User-Agent parser and any public-suffix or
      geography packages before merge.

## Non-goals

This task builds Web page analytics, not every future behavioral analytics or
observability feature.

- Automatic click, form, element, or outbound-link capture.
- Session replay, DOM snapshots, console capture, or network bodies.
- Scroll depth or arbitrary engagement heartbeats.
- Web Vitals, resource timing, tracing, or performance monitoring.
- Goal/conversion configuration, funnels, retention, paths, or cohorts.
- Search-term extraction from arbitrary queries or referrer URLs.
- Exact geolocation, an installation map, or user fingerprinting.
- Mobile screen analytics for React Native, iOS, or Android.
- Node/server page analytics.
- Project-configurable reporting timezones or unlimited historical scans.
- Permanent high-cardinality rollups before hosted query evidence requires
  them.

## Definition of done

Task 17 is complete when an external hosted React application can enable page
tracking and an authorized project member can inspect accurate page analytics
without custom event conventions or database access.

- [ ] Browser history mode and React manual mode capture exactly one canonical
      page view per intended navigation.
- [ ] Page sessions survive hard navigation, expire after 30 minutes of
      inactivity, and reset correctly with consent/identity lifecycle.
- [ ] Accepted page views are atomically projected with trusted Web-source,
      identity, bounded technology, and optional coarse geography context.
- [ ] Web analytics displays Page views, Visitors, Sessions, Views per session,
      Bounce rate, trend, Top pages, Referrers, Campaigns, Locations, and
      Technology using the frozen definitions.
- [ ] The page aggregates all Web sources by default and filters by actual
      source without including Mobile or Server traffic.
- [ ] Every Layout state, responsive behavior, and accessibility requirement is
      implemented with real typed API data.
- [ ] No raw URL query/hash, User-Agent, IP, exact coordinate, or pre-consent
      browsing state is stored or exposed.
- [ ] Packed Core, Browser, and React artifacts pass the external hosted live
      proof and all focused closure gates.

## Progress log

Implementation agents must append dated entries with the completed slice,
decisions, migrations, affected files, focused tests, and deliberately deferred
work. Review findings belong in new review sections after the log.

### 2026-08-22 - task created

The task was created after a read-only review of the current Core, Browser,
React, ingestion, analytics storage, event reads, sidebar, design system, and
event-system documentation. No SDK, API, schema, or Web application code was
changed during this planning pass.

### 2026-08-22 - slice 1: contracts frozen + metric fixtures

Frozen the executable contract surface before any capture/persistence work:

- `packages/core/src/page-view.ts` (new): reserved `$prism_` namespace +
  `$prism_page_view` name; `PageViewCandidate` / `PageViewWireProperties`
  (`$page` / `$referrer` / `$campaign`) / `ManualPageViewInput` /
  `BrowserPageViewOptions` / `UsePrismPageViewOptions`; strict
  `validatePageViewProperties()` shared by SDK pre-send and server
  pre-persistence; `PAGE_VIEW_LIMITS` freezes the 30-minute Web-session
  timeout, 15-minute late-delivery geo cutoff, 13-month dashboard range,
  50-row rankings, and 5-session city suppression; viewport width buckets.
- Public `track()` now rejects the reserved prefix (throws like other
  invalid input); the internal seam arrives with Slice 2.
- `packages/types`: `WebAnalyticsResource` + filters/totals/comparison/
  trend/ranking groups/coverage, `WebAnalyticsRequest`, and the
  `WebPageViewProjection` row shape (migration lands in Slice 4).
- Fixtures: `fixtures/task-17-web/` — 11 deterministic scenarios
  (multi-page, bounce, repeat visitor, hard-nav resume, React manual route,
  campaigns, referrers, bot, unknown technology, late offline delivery,
  suppressed cities) with fixed epoch timestamps and synthetic identities.
- Tests: core `page-view.test.ts` (reserved-prefix rejection through public
  track(), canonical acceptance, 16 malformed-input rejections, bounds) and
  types `webAnalyticsContracts.test.ts` (Other/Unknown labels, no-infinity
  comparison kinds, null-bounce anatomy).
- Core CJS bundle budget raised 100→112 KiB for the new contract module
  (documented in dist-consumer.test.ts); full core suite 169/169.

Deliberately deferred to later slices: Browser history/manual runtime,
sessionStorage resume, React hook implementation, UA/geo enrichment,
`web_page_views` migration, read-model queries, and the dashboard page.

### 2026-08-22 - slices 2-5 + 7 (docs): SDK capture through read model

- **Slice 2**: Core symbol-keyed internal seams (`createReservedEvent`,
  `resumeWebSession`/`detachWebSession`) keep reserved-event creation and
  session resume out of application reach while enforcing consent,
  sanitization, queue capacity, and the frozen page-view schema.
  Browser `page-tracker.ts`: reference-counted History patch (native
  restore on last detach), history/manual modes, sessionStorage Web
  sessions per tab resuming across hard navigations inside the frozen
  30-minute window, same-path suppression within one JS lifetime,
  external-only referrer host, UTM allowlist-only campaign capture,
  title opt-in, throwing-safe beforeCapture. Public startSession() emits
  `session_started` exactly once; resumes attach silently. 11 browser
  tests; suite 67/67.
- **Slice 3**: router-neutral `usePrismPageView()` requiring a ready
  Browser client in manual mode; misuse throws specific errors; Strict-
  Mode single-capture proven against the REAL Browser tracker; browser
  added as explicit React devDependency. Packed-tarball fixture proof
  deferred to the hosted pass (standing constraint).
- **Slice 4**: migration 012_web_page_views (+4 reviewed indexes);
  ingestion rejects non-web/malformed/host-mismatched reserved events
  individually; pinned ua-parser-js@2.0.10 technology classification with
  explicit bot vocabulary and raw-UA discard; optional IPinfo geography
  behind TRUST_PROXY fail-closed + timeboxed failure isolation; late
  deliveries (>15 min) accept without geo; projections insert in the SAME
  transaction only for idempotency winners; person deletion, project
  deletion, and retention sweep linked projections; safe counters.
- **Slice 5**: authorized GET /projects/:slug/web-analytics — membership,
  web-source filter validation, 13-month ceiling, fully parameterized SQL,
  zero-filled UTC buckets, prior-period New/No-prior-data comparisons,
  nullable bounce until completion, Direct/campaign/referrer folding from
  entry rows, server-side <5-session region/city suppression to Other,
  50-row ranking caps, coverage percentages. Typed client hook with stable
  cache key. Assembler unit tests 7/7.
- **Slice 7 (docs portion)**: engineering/event-system.md §9 and the
  error-tracking threat-model addendum document the boundaries above;
  Sources setup snippets ride the deferred slice-6 UI work.

Closure gates run: core 169, types 7, browser 67, react 30, analytics-api
166+5 skipped, api 172+19 skipped — all green; core/types builds green;
web build green. Deliberately deferred: dashboard page (slice 6), hosted
deployment proof, packed-tarball fixture, Sources setup UI.
