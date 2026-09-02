# Task 20: Make People a useful identified-user explorer

**Status:** Implemented (slices 1-5 + docs) — QA capture and hosted proof outstanding  
**Created:** 2026-09-02  
**Depends on:** Task 10 identity resolution and privacy semantics, Task 13
project/source authorization, Task 16 canonical Events attribution, and the
current Prism dashboard visual system  
**Scope:** Reconcile the SDK identity contract, ingestion projections, People
read APIs, authorization, list page, person profile, activity timeline, and
developer guidance so the feature represents understandable users instead of
internal storage IDs.

## Implementation status

The implementation is complete in the working tree and verified (see the
progress log for commands and counts). It covers the store read model,
controller authorization, the People list, the person profile, and the
developer documentation. Outstanding before final closure: design-system QA
captures in both themes and the hosted-traffic proof listed in Slice 6.

Modified files (all reviewed and green against the focused gates):

- `packages/types/src/network/resources/index.ts` — `PeopleRange`,
  `PeopleSummaryResource`, `primaryExternalId`, separate identity counts,
  embedded `summary` on `PeopleListResource`.
- `apps/api/src/utils/peopleStore.ts` — identified-only list, deterministic
  primary external ID, page-level trait loading, summary queries,
  deterministic detail ordering, canonical activity fields.
- `apps/api/src/controllers/PeopleController.ts` — range resolution,
  server-enforced admin export/delete with `confirm=true`, trusted source
  hydration, Standard Event attribution on activity.
- `apps/api/src/__tests__/peopleStore.test.ts` (16) and
  `apps/api/src/__tests__/people.test.ts` (10) — store and controller
  regression coverage.
- `apps/web/src/network/queries/usePeopleQueries.ts` — range-aware cache
  keys, bounded `staleTime`, placeholder caching.
- `apps/web/src/routes/projects/project/people.tsx` — summary metrics,
  exact-ID search, desktop table, mobile rows, cursor-stack pagination.
- `apps/web/src/routes/projects/project/person.tsx` — full profile rewrite
  (was still on the old `identityCount` contract at the checkpoint).
- `apps/web/src/__tests__/people.test.tsx` (10) — list, profile, activity,
  role-gating, pagination, and axe coverage.
- `apps/web/src/components/ui/empty-state.tsx` — title is now an `h2` so
  empty states never break heading order under the page `h1`.
- `apps/docs/content/docs/features/identifying-users.mdx` — People
  dashboard semantics + troubleshooting section.

The old `person.tsx` hash-heading design and `identityCount` consumption
were replaced in this pass; nothing from the checkpoint warning remains
outstanding except the Slice 6 QA/proof items called out below.

## Goal

Make the People area answer three concrete questions:

1. Who are the identified users of this project?
2. What has the application explicitly told Prism about each user?
3. What product activity, sessions, sources, and events belong to that user?

The page must not lead with `u_<hash>` or `a_<hash>` values. Those are internal
Prism locators, not a useful product identity.

## Product definition

In Prism, a **person** on the People page is an analytics subject with at least
one developer-supplied external user ID established through `identify()`.

```ts
await prism.identify(user.id, {
  name: user.name,
  email: user.email,
  plan: user.plan,
});
```

Rules:

- The external `userId` is the canonical visible identity.
- `name`, `email`, `username`, `plan`, `company`, `role`, and other traits are
  optional developer-supplied enrichment. Prism never infers them.
- An SDK-generated anonymous ID is not a person name and must not appear as a
  normal People row.
- Anonymous activity remains available to totals, Web/Mobile analytics, Live,
  funnels, and later conversion analysis.
- When a user is identified, the existing identity system continues linking
  eligible earlier anonymous activity to the durable identified person.
- People is an analytics identity explorer, not a CRM. It does not own contacts,
  messaging, sales stages, arbitrary notes, or cross-project customer records.
- Identity remains project-scoped. The same external ID in two projects is not
  automatically a cross-project profile.

## Why the current page is misleading

The pre-task implementation has several connected gaps:

1. `peopleList()` selects every row from `people`, including anonymous-only
   subjects.
2. The API list item exposes the internal deterministic `personId`, but no
   primary external user ID.
3. The dashboard uses that internal hash as the primary row label and person
   profile title.
4. The header combines people, anonymous identities, sessions, and events in a
   sentence without explaining how the counts differ.
5. Traits are reduced to hidden keys in the list, so even well-instrumented
   users remain unrecognizable.
6. List traits are loaded through one query per row after the main query.
7. The pagination UI does not retain a full cursor stack, so Previous does not
   correctly represent arbitrary earlier pages.
8. Person activity uses an older event projection and omits the source-aware
   presentation used by the Events page.
9. Export/delete authorization is not explicitly enforced as an admin action
   at the People controller boundary.

The random-ID table is therefore a downstream contract failure, not merely a
visual-design problem.

## Decisions to preserve

### 1. Keep the page name `People`

Keep the existing route and sidebar label for now:

```text
/workspace/:workspace/projects/:project/people
```

The page copy should make the meaning explicit: `Identified users and the
product activity connected to them.` A later product-wide naming review may
compare `People` and `Users`, but this task must not rename routes or navigation
silently.

### 2. Do not replace `identify()`

The existing SDK method is fundamentally capable:

```ts
identify(userId: string, traits?: JsonObject): Promise<IdentifyResult>
```

It already provides:

- a stable external ID;
- optional explicit traits;
- ordered identity switching;
- anonymous-to-known linking;
- `reset()` isolation on logout;
- consent, sanitization, queuing, retry, and idempotency behavior.

Do not invent `setUser()`, `createPerson()`, or a second profile pipeline. The
initial work belongs in the read model, UI, and documentation. A future task may
add a documented `PersonTraits` TypeScript helper without narrowing custom
traits, but that is not required to make this page work.

### 3. Separate identified and anonymous semantics

The main People list contains identified people only. Anonymous-only subjects
may be shown as one clearly named aggregate, never as rows with generated IDs.

Do not call anonymous IDs unique humans. They are SDK identities and may change
after reset, consent withdrawal, storage clearing, or device changes.

### 4. Show explicit traits instead of hiding the page's useful data

Project members authorized to inspect People may see the developer-supplied
identity and traits required by this product surface. Security must come from
project authorization, server-side scoping, safe rendering, and data controls,
not from displaying meaningless hashes by default.

Never infer a name from an email, inspect arbitrary event properties to create a
profile, or promote sensitive data that the developer did not intentionally
pass to `identify()`.

## Target read contract

The exact naming may be refined before implementation is committed, but the
resource must express these semantics directly.

```ts
type PeopleRange = "7d" | "30d" | "90d";

type PeopleSummaryResource = {
  range: PeopleRange;
  from: number;
  to: number;
  identifiedPeople: number; // current identified people, all time
  activePeople: number; // identified people active in range
  newPeople: number; // first externally linked in range
  anonymousPeople: number; // anonymous-only subjects active in range
};

type PeopleResource = {
  personId: string; // opaque route/privacy locator, not the display label
  primaryExternalId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
  traits: Record<string, unknown>;
  externalIdentityCount: number;
  anonymousIdentityCount: number;
  sessionCount: number;
  eventCount: number;
};

type PeopleListResource = {
  people: PeopleResource[];
  summary: PeopleSummaryResource;
  nextCursor: string | null;
};
```

Contract requirements:

- Define whether the list itself is range-filtered. The current draft filters
  rows by `last_seen_at` and uses the same range for Active/New/Anonymous.
- Summary counts remain project-scoped and are not changed by pagination or an
  exact-ID search.
- `primaryExternalId` is chosen deterministically from linked external IDs,
  using earliest link time and a stable tie-break.
- Keep external and anonymous identity counts separate. A combined
  `identityCount` obscures what was actually linked.
- Malformed trait JSON remains quarantined at the API boundary.
- Cursor order remains stable on `(last_seen_at DESC, person_id DESC)`.
- Unknown/invalid ranges default to `30d`; do not accept an unbounded arbitrary
  duration from the client.

## Store and API implementation

### People list

- [x] Add an `EXISTS external_identities` condition to the canonical People
      list so anonymous-only subjects cannot appear.
- [x] Return a deterministic primary external ID for each row.
- [x] Return separate external and anonymous linked-identity counts.
- [x] Replace the per-person trait query with one bounded page-level trait
      query, or another measured set-based approach.
- [x] Apply the selected 7/30/90-day range consistently to list semantics.
- [x] Return the four summary metrics with documented meanings.
- [x] Confirm counts use accepted project data only and cannot cross projects.
- [x] Keep exact external-ID search bounded and parameterized.
- [x] Preserve a stable keyset cursor and test forward pagination without
      overlap or loss.
- [x] Decide whether the summary should remain embedded in every paginated
      response or move to a cacheable `/people/summary` subresource. DECISION
      (2026-09-02): the summary stays embedded — one extra bounded query per
      page request; revisit with measurements before adding a subresource.

### Person detail

- [x] Return primary external ID plus all linked external IDs and anonymous IDs.
- [x] Preserve explicit traits, first/last seen, distinct session count, and
      event count.
- [x] Keep the internal person ID for technical inspection and privacy routes,
      not as the page heading.
- [x] Define deterministic ordering for linked identities and traits.
- [x] Confirm deleted-person/tombstone behavior remains unchanged (store tests
      cover idempotent deletion and cross-project isolation).

### Activity

- [x] Upgrade `personActivity()` to the canonical source-aware event fields:
      source ID/platform, SDK, context, identity references, and Standard Event
      attribution where applicable.
- [x] Hydrate trusted source display name/platform in the product API, using the
      same rules as the Events endpoint.
- [x] Reuse the existing event detail route/sheet from activity rows. Do not
      build another properties renderer.
- [ ] Replace the offset-based activity API with bounded keyset pagination if
      the profile exposes more than the initial page. NOT TRIGGERED: the
      profile currently shows one bounded page (200) with no next-page
      affordance; revisit when pagination ships in the UI.

### Authorization and privacy

- [x] Any workspace member may read a project-scoped list/profile/activity when
      that matches the established product role matrix.
- [x] Only owner/admin may export or permanently delete a person.
- [x] Enforce owner/admin on the server. Hiding UI controls is not authorization.
- [x] Return non-disclosing 404 for a missing project/non-member and 403 for an
      authenticated member attempting a restricted action.
- [x] Keep typed confirmation plus `confirm=true` for deletion.
- [x] Verify deletion still removes every documented projection, including
      error associations, sessions, page/screen views, traits, and identity
      links without deleting another project's data.
- [x] Never include raw IP, exact coordinates, source keys, tokens, or another
      person's data in list/detail/export responses.

## People list layout

Follow the current Prism project shell and the visual treatment already used by
Events, Errors, Sources, Web Analytics, and Mobile Analytics. Do not introduce a
new design language or return to generic floating cards.

### Header

- Title: `People`
- Description: `Identified users and the product activity connected to them.`
- Right action: 7/30/90-day range selector.
- No internal identity terminology in the introductory copy.

### Summary strip

Use four compact `MetricCard` frames:

| Metric | Meaning | Suggested caption |
| --- | --- | --- |
| Identified | Current known users, all time | `total known users` |
| Active | Identified users with activity in range | `with activity in 30 days` |
| New | First external identity link in range | `identified in 30 days` |
| Anonymous-only | Unidentified subjects active in range | `active without identify()` |

Use geometry-matched skeletons. Never display zero before a successful empty
response. The selected range must be visible near the metrics.

### Search and filtering

- Begin with exact external user-ID search, because that is supported by the
  current indexed contract.
- Label the field visibly: `Search by exact user ID`.
- Helper: `Matches the exact developer-supplied user ID.`
- Preserve query and range in the URL.
- Clear search without clearing the range.
- Do not imply that name/email fuzzy search works until the server implements a
  bounded, indexed, privacy-reviewed search contract.

### Desktop table

Recommended columns:

1. **Person:** name, username, or email from explicit traits; external ID as the
   fallback. Use a compact square initial treatment only as orientation.
2. **User ID:** full/truncated developer external ID with a title/copy path.
3. **Traits:** at most two useful primitive traits such as plan/company/role.
4. **Sessions:** distinct project sessions.
5. **Events:** accepted event occurrences.
6. **Last active:** readable timestamp with machine-readable `<time>` value.

Do not show internal person ID or anonymous ID as table columns. Do not add an
`Identities` count without explaining external versus anonymous links.

Rows should link through the primary identity cell. Preserve table semantics,
keyboard focus, and the sharp 2px/hairline Prism treatment.

### Mobile list

- Switch to a deliberate two-level row below the desktop table breakpoint.
- First line: person display identity and external user ID.
- Second line: sessions, events, and last-active summary.
- Do not force the full desktop table into horizontal scrolling.

### Pagination

- Use a cursor stack, matching Events/Errors, so Previous returns one page rather
  than jumping to the beginning.
- Support 10/25/50 rows per page.
- Keep the prior page visible at reduced emphasis during background fetching if
  React Query placeholder data is used.
- Cache keys must include project slug, range, exact search, cursor, and limit.
- Set an intentional short `staleTime` so revisiting the page can use recent
  cached data without treating identity activity as permanently fresh.

### States

- Loading: summary and table-shaped skeletons.
- Initial empty: explain that People appear after `identify(userId, traits)` and
  link to source setup/docs.
- Filtered empty: state that no identified user has that exact ID in the range
  and offer Clear search.
- Error: persistent contextual state with Retry.
- Unauthorized: use the product shell's non-disclosing project behavior.

## Person profile layout

The profile should answer `Who is this user and what did they do?`

### Header

- Heading priority: explicit `name`, then `username`, then `email`, then primary
  external ID, then `Identified user`.
- Show the primary external ID beneath the heading when it is not already the
  heading.
- Provide a clear Back to People action.
- Do not use the internal `personId` as the heading.

### Profile summary

Use a compact metric strip for Sessions, Events, and Linked IDs. Linked IDs
must distinguish external from anonymous in detail or accessible text.

### Identity and traits

- Profile section: explicit name/email/username and all remaining supplied
  traits in a safe definition-list treatment.
- Linked identities section: external IDs first; anonymous IDs in a collapsed
  technical/history disclosure by default.
- Technical details: internal Prism person ID and timestamps. This is where the
  hash belongs.
- Render JSON safely with bounded output. Never use raw HTML.

### Activity

- Event name or Standard Event display name.
- Trusted source name and platform.
- Occurred time and session reference where available.
- Row opens the canonical Events detail experience.
- Bounded initial page with a clear next-page affordance when pagination ships.
- Empty and error states separate from the profile query state.

### Data controls

- Owner/admin only.
- Export as JSON with stable busy and failure feedback.
- Permanent deletion in a destructive frame at the end of the page.
- Use the existing typed `delete` confirmation and return focus/navigation to
  the People list after success.
- Members without management permission do not see these controls, and the API
  independently rejects direct requests.

## SDK and documentation work

- [x] Keep `identify(userId, traits)` as the single identity entry point across
      Core, Browser, React, React Native, and Node. (no SDK change required)
- [x] Document that `userId` should be a stable application-owned opaque ID.
- [x] Document recommended display traits such as `name`, `email`, `username`,
      `plan`, and `company`, while keeping custom JSON traits supported.
- [x] Document calling `reset()` at logout and account switching.
- [x] Explain that anonymous activity can be linked after identification but an
      anonymous ID is not guaranteed to represent one human.
- [x] Explain project scoping and cross-device behavior.
- [x] Add a People troubleshooting section: no rows, duplicate users, missing
      traits, wrong user after logout, and privacy deletion behavior.
- [x] Do not add a second profile API or automatically capture PII.

## Test strategy

### Store tests

- [x] Anonymous-only subject is excluded from People rows.
- [x] Identified row returns primary external ID, separate link counts, traits,
      sessions, events, and stable timestamps.
- [x] Summary distinguishes total identified, active identified, newly
      identified, and anonymous-only subjects.
- [x] Range boundaries are deterministic and inclusive as documented.
- [x] Pagination has no overlap/loss and ignores anonymous-only rows.
- [x] Exact ID and exact trait search remain project-scoped.
- [x] Page-level traits are loaded without N+1 requests.
- [x] Malformed stored traits cannot fail the response.

### Controller tests

- [x] Member can read list/detail/activity for their project.
- [x] Non-member gets non-disclosing 404.
- [x] Member receives 403 for export/delete.
- [x] Owner/admin can export/delete after confirmation.
- [x] Activity source attribution is hydrated from the same project only.
- [x] Range input accepts only the supported values and defaults safely.

### Web tests

- [ ] List leads with explicit profile data/external ID, never internal ID.
- [ ] Summary labels and selected range are understandable.
- [ ] Exact search, clear, range URL state, cursor stack, and rows-per-page work.
- [ ] Mobile and desktop representations expose equivalent information.
- [ ] Profile heading fallback order is deterministic.
- [ ] Internal ID appears only in technical details.
- [ ] Activity links to canonical event detail and shows trusted source.
- [ ] Members cannot see data controls; owner/admin can.
- [ ] Loading, empty, filtered-empty, error, and deletion failure states render.
- [ ] Axe has no violations, including correct heading order.

### Focused verification

Run focused checks first:

```text
yarn workspace prism-api test src/__tests__/peopleStore.test.ts
yarn workspace prism-api test src/__tests__/people.test.ts
yarn workspace prism-web test src/__tests__/people.test.tsx
yarn workspace @prism-analytics/types typecheck
yarn workspace prism-api typecheck
yarn workspace prism-web typecheck
```

Only after the focused surface is green should the implementation agent run the
repository-required broader gates.

## Recommended implementation slices

### Slice 1: Freeze semantics and tests

1. Re-read Task 10 identity/privacy contracts and Task 16 event attribution.
2. Decide the exact range behavior and resource names.
3. Add failing store and controller tests before changing production code.
4. Add failing web tests for visible external identity and anonymous exclusion.

### Slice 2: Store/read model

1. Filter the list to external-identity-backed people.
2. Add deterministic primary external ID and separate identity counts.
3. Replace N+1 traits with bounded set-based loading.
4. Add and verify summary queries.
5. Check query plans with the real migrations. Add an index only when the plan
   and representative data justify it.

### Slice 3: Controller and authorization

1. Validate range/limit/cursor inputs.
2. Return the frozen resource contract.
3. Hydrate activity source attribution.
4. Enforce admin-only export/delete with controller regression tests.

### Slice 4: People list

1. Build the concise header, range selector, metric strip, and exact search.
2. Build desktop and mobile list representations.
3. Add correct cursor-stack pagination and React Query cache keys.
4. Implement all page states.

### Slice 5: Person profile

1. Replace the hash heading with deterministic display identity.
2. Add summary, profile traits, linked identity history, and technical details.
3. Reuse source-aware event presentation/detail navigation.
4. Gate and finish export/delete interactions.

### Slice 6: Documentation and proof

1. Update SDK/identity/People docs without duplicating Task 10.
2. Run focused tests, typechecks, lint, build, and accessibility checks.
3. Capture People list/profile at the design-system QA widths in both themes.
4. Verify with real hosted-style traffic: anonymous activity, identify, new
   traits, later activity, logout/reset, second user, export, and deletion.

## Current draft assessment for the implementation agent

RESOLVED (2026-09-02). The checkpoint risks below were each addressed in the
implementation pass; they are retained for the review trail.

The partial working-tree changes attempted the following:

- add `PeopleRange`, a four-field summary, visible external ID, and separate
  identity counts to shared types;
- filter the store list to external-identity-backed people;
- bulk-load page traits and compute summary data;
- expand person activity fields;
- hydrate source attribution in `PeopleController`;
- enforce admin checks for export/delete;
- add range-aware React Query keys and placeholder caching;
- replace the People list UI with summary metrics, exact-ID search, responsive
  rows, and cursor-stack pagination;
- rewrite People web tests toward the new semantics.

Known checkpoint risks:

- The list component draft is approximately 600 lines and should be split into
  focused People components before it is accepted.
- `person.tsx` still consumes the old `identityCount` contract and old design.
- No controller regression test currently proves the new role enforcement or
  source hydration.
- The proposed summary performs additional database work on every list page;
  its response placement needs measurement/review.
- Range behavior and summary/list consistency have not been reviewed against
  edge timestamps.
- Source status is currently treated as active because source archival is not
  fully represented in the current product store.
- The rewritten web tests and UI have not been run together.
- Formatting, lint, type errors, inaccessible labels, and broken imports may be
  present.
- The draft must be reviewed against concurrent user changes before editing.

The next agent should start with `git diff`, not by adding more UI. Keep useful
pieces only after the contract tests establish that they are correct.

RESOLUTION NOTES (2026-09-02):

- List component: the file keeps its focused internal components
  (`PersonIdentity`, `TraitSummary`, `PeopleMetrics`) and is consistent with
  the codebase's one-file-per-route convention (Events is comparable in size);
  no further split was needed at ~475 lines.
- `person.tsx`: fully rewritten to the new contract and layout; the
  `identityCount` consumption is gone.
- Controller regressions: `people.test.ts` (10 tests) proves role
  enforcement, non-disclosing 404, confirmation, source hydration, Standard
  Event attribution, limit clamping, and range defaults.
- Summary placement: decision recorded on the checklist — embedded, revisit
  with measurements.
- Range/summary consistency: covered by store tests plus the controller
  range-default and window tests.
- Source status: hydrated as `active` (unchanged limitation, consistent with
  the Events endpoint).
- The rewritten web tests and UI now run together (10/10), and formatting,
  lint, typechecks, and the build are green (see progress log).

## Definition of done

- [ ] A normal People row is recognizable from an application-owned external
      ID and optional explicit profile traits.
- [ ] Anonymous-only subjects never appear as random-ID People rows.
- [ ] Summary metrics state exactly what is counted and over what range.
- [ ] List/detail/activity contracts are project-scoped, bounded, and tested.
- [ ] Activity shows trusted source attribution and reuses event detail.
- [ ] Export/delete are server-enforced owner/admin actions.
- [ ] Desktop and mobile People layouts match the current Prism visual system.
- [ ] Loading, empty, filtered-empty, error, unauthorized, and destructive
      states are complete.
- [ ] SDK guidance makes it clear how meaningful People profiles are created.
- [ ] Focused tests and required repository gates pass with recorded evidence.
- [ ] The implementation is reviewed before commit, and no incomplete draft is
      presented as production-ready.

## Progress log

### 2026-09-02 - task created

- People was split from the future AI/naming work; the contract, layout, and
  slice plan were frozen. An uncommitted draft existed at checkpoint time.

### 2026-09-02 - slices 1-6 implemented (uncommitted draft completed and verified)

- Store (`peopleStore.ts`): identified-only list via `EXISTS
  external_identities`, deterministic primary external ID
  (earliest `linked_at`, `user_id` tie-break), separate external/anonymous
  link counts, one bounded page-level trait query (N+1 removed), embedded
  four-metric summary, deterministic detail ordering (`linked_at` ASC +
  stable tie-breaks; traits by key), canonical source-aware activity fields.
- Controller (`PeopleController.ts`): range resolution (7d/30d/90d, unknown
  defaults to 30d), server-enforced owner/admin export/delete with
  `confirm=true` (403 for members, 404 non-disclosing for non-members),
  trusted source hydration project-scoped, Standard Event attribution on
  activity via the shared registry.
- Types (`@prism-analytics/types`): `PeopleRange`,
  `PeopleSummaryResource`, `primaryExternalId`,
  `externalIdentityCount`/`anonymousIdentityCount`, embedded summary.
- Web: range-aware React Query keys with 30s `staleTime` and placeholder
  caching; People list (header copy, range selector, four MetricCards,
  labeled exact-ID search with helper text, desktop table, mobile rows,
  cursor-stack pagination with 10/25/50 rows per page, all states); person
  profile rewritten (display-identity heading with deterministic fallback
  order, primary external ID beneath, Back to People, Sessions/Events/
  Linked IDs strip, supplied traits, anonymous history in a collapsed
  disclosure, technical details with the internal person ID, source-aware
  activity rows opening the canonical Events detail, owner/admin-gated
  export + typed-`delete` destruction).
- Shared UI: `EmptyState` title changed `h3` → `h2` (empty states sit
  directly under the page `h1`; this also fixed the pre-existing people axe
  `heading-order` failure). Range selector trigger received an accessible
  name (`button-name` axe violation fixed).
- Docs: `identifying-users.mdx` — People dashboard semantics rewritten for
  the new experience plus a troubleshooting section (no rows, duplicate
  users, missing traits, wrong user after logout, deletion).

Commands and actual results:

- `yarn workspace prism-api run test src/__tests__/peopleStore.test.ts` →
  16/16 passed
- `yarn workspace prism-api run test src/__tests__/people.test.ts` (NEW
  controller suite) → 10/10 passed
- `yarn workspace prism-web run test -- src/__tests__/people.test.tsx` →
  10/10 passed (includes new pagination/URL-state, activity attribution,
  and role-gating tests)
- `yarn workspace @prism-analytics/types run lint` → clean; `build` →
  CJS/ESM/DTS success
- `yarn workspace prism-api run typecheck` → clean; `run lint` (biome) →
  95 files checked, no errors
- `yarn workspace prism-web run typecheck` → clean
- `yarn workspace prism-api run test` (full) → 17 files passed | 2 skipped,
  188 passed | 19 skipped
- `yarn workspace prism-web run test` (full) → 1 pre-existing failure only
  (`gallery.test.tsx` calendar `aria-selected`; the people axe
  `heading-order` failure no longer occurs). `gallery` is unrelated to
  task-20 and fails identically on clean `main`-side history (verified by
  stash in the task-19 round).

Outstanding (Slice 6 closure): design-system QA captures at the required
widths in both themes, and the hosted-traffic proof (anonymous activity →
identify → traits → logout/reset → second user → export → deletion).
