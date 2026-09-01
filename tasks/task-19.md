# Task 19: Add typed Standard Events across Prism SDKs

**Status:** Ready for implementation  
**Created:** 2026-09-01  
**Depends on:** Task 9's Core delivery contract, Task 10 identity semantics,
Task 13 source-aware ingestion, Task 14's Browser/React package proof, Task
16's canonical Events read model, and Task 18's React Native client  
**Scope:** Add a small, frozen catalog of developer-invoked Standard Events,
strict shared validation, SDK helper APIs, trusted ingestion behavior, readable
representation in the existing Events explorer, and complete developer docs.

## Goal

Give application developers stable, typed helpers for common product and
commercial lifecycle events without asking every project to invent its own
event names or property conventions.

The intended experience is:

```ts
await prism.identify(user.id);
prism.events.signUp({ method: "email" });
prism.events.onboardingCompleted({ flowId: "workspace_setup" });
```

For server-owned outcomes:

```ts
prism.events.subscriptionCancelled(
  {
    subscriptionId: subscription.analyticsId,
    planId: "pro_monthly",
    reasonCode: "customer_requested",
  },
  { userId: user.id },
);
```

Each helper must emit one protected `$prism_*` event through the existing
consent, queue, batching, retry, source attribution, identity, and retention
path. Accepted events remain normal project events. The task does not create a
second analytics pipeline.

## Scope boundary

This task is only about defining, capturing, validating, documenting, and
displaying Standard Events in the existing Events experience.

It includes:

- the frozen event names, meanings, property types, and validation limits;
- `prism.events.<helper>()` on Core, Browser, React, and React Native clients;
- an equivalent Node/server capture path;
- server-side validation of every protected event;
- source, identity, session, SDK, and timestamp attribution already supplied by
  the current event pipeline;
- readable Standard Event labels in the existing Events list and detail view;
- package README/API reference updates and one dedicated docs page;
- packed-package and real-ingestion regression proof.

It explicitly does not include:

- AI Insights, an AI assistant, chat, agent memory, or LLM tools;
- overview widgets, signup cards, recommendations, or generated observations;
- aggregate Standard Event endpoints, conversion reports, revenue reports,
  funnels, retention, cohorts, or a new dashboard page;
- a `standard_events` projection table or other analysis-specific storage;
- automatic inference of business events from routes, clicks, API responses,
  identity operations, billing webhooks, or existing custom events;
- user-defined remapping of custom events to Standard Events;
- group/account analytics or organization-level identity;
- account deletion, consent erasure, or subscription entitlement behavior;
- provider integrations such as Stripe webhook ingestion.

Future tasks may build deterministic metrics and AI tools on these contracts.
This task must not pre-implement those features.

## Why Standard Events exist

Custom events remain necessary:

```ts
prism.track("report_exported", { format: "csv" });
```

They are intentionally project-defined. Prism cannot safely assume that
`signup_completed`, `account_created`, and `registered` mean the same thing.

Standard Events solve a narrower problem. Prism owns the name and schema, and
the developer explicitly calls the helper at the documented business boundary:

```ts
prism.events.signUp({ method: "email" });
```

This gives Prism stable semantics without pretending it can infer business
success from a button click or URL. The protected name is an implementation
detail; the typed helper is the public API.

## Current baseline

| Area | Current implementation | Required addition |
| --- | --- | --- |
| Core SDK | `track()`, ordered `identify()`, sessions, consent, queueing, retries, and a symbol-keyed reserved-event seam. | A typed, stable `events` helper namespace and exact Standard Event validators. |
| Protected names | Public `track()` rejects `$prism_*`; page and mobile SDKs use protected events internally. | Reject unknown protected names at ingestion and recognize the Standard Event catalog. |
| Browser | Uses Core and adds page tracking. | Inherit the complete client-safe Standard Event namespace without a second queue. |
| React | Exposes a stable bound facade through `usePrism()`. | Expose the same stable `events` object through `usePrism()` and `useOptionalPrism()`. |
| React Native | Uses Core and adds mobile lifecycle/screen tracking. | Inherit the same Standard Event namespace without changing mobile session ownership. |
| Node | Has a runtime adapter and error reporter, but no public analytics-client factory. | Expose a small `createNodeClient()` wrapper suitable for server-owned Standard Events. |
| Ingestion | Validates generic events and the existing page/mobile protected schemas. | Strictly validate every known Standard Event and reject all unknown `$prism_*` events. |
| Storage | Canonical `events` rows already store name, properties, identity, session, source, SDK, and timestamps. | No new table. Store valid Standard Events as canonical events. |
| Product API | Returns the canonical event list/detail contracts. | Add optional derived Standard Event display metadata without hiding the raw name. |
| Dashboard | Events currently renders the raw event name. | Render a readable Standard Event label and category in the existing list/detail surfaces. |
| Docs | Documents custom events and automatic page/mobile events. | Document the helper catalog, exact call boundaries, schemas, and producer guidance. |

## Product and architecture decisions

The decisions below are part of the task contract. Change them in this file
before code relies on a different interpretation.

### 1. Call them Standard Events

Use **Standard Events** in the SDK, dashboard, docs, and code comments.

- **Custom event** means a developer-defined `track()` name and schema.
- **Standard Event** means a Prism-defined helper, protected event name, and
  versioned schema.
- **Automatic event** means an SDK-owned record such as a page view, screen
  view, or app lifecycle record that the SDK creates from configured runtime
  behavior.

Standard Events are developer-invoked. They are not automatic and they are not
generic custom events.

### 2. Use one helper namespace

The public client API is `prism.events`, not 25 new top-level client methods.

```ts
prism.events.signUp({ method: "email" });
prism.events.search({ category: "documentation", resultCount: 8 });
prism.events.subscriptionCancelled({
  subscriptionId: "sub_analytics_01",
  planId: "pro_monthly",
});
```

`events` contains only the frozen Standard Event helpers. Custom events remain
under `track()`:

```ts
prism.track("report_exported", { format: "csv" });
```

Do not add a generic escape hatch such as
`prism.events.capture(name, properties)`. That would duplicate `track()` and
weaken the protected schemas.

### 3. Standard Events use the existing delivery lane

Every helper uses the current event queue and wire envelope.

- Keep wire event `type: "track"` for this release.
- Generate the normal client-owned event ID.
- Preserve existing consent, queue capacity, persistence, batching, retry,
  diagnostic, flush, and shutdown behavior.
- Preserve current immutable identity, anonymous identity, session, runtime,
  source, SDK, `occurredAt`, and `receivedAt` attribution.
- Count Standard Events against the normal analytics event quota.
- Store them in the canonical `events` table.
- Return the normal synchronous `CaptureResult`.

Do not introduce a Standard Event endpoint, queue, batch envelope, database,
or retention policy.

### 4. Helpers own protected names

The canonical protected event names are listed in the catalog below. Public
calls such as this must continue to throw:

```ts
prism.track("$prism_sign_up", { method: "email" });
```

Only the typed helper may create that record:

```ts
prism.events.signUp({ method: "email" });
```

Ingestion must reject:

- an unknown `$prism_*` name;
- a known Standard Event with the wrong schema;
- a known Standard Event containing unknown fields;
- a known Standard Event whose inner event key disagrees with its protected
  event name;
- a malformed automatic event using an existing protected name.

Direct HTTP clients never gain a permissive protected-event path.

### 5. Calls mark successful business boundaries

The SDK never guesses that a Standard Event happened. The developer calls it
only after the business operation succeeds.

- `signUp` is called after durable account creation, not on submit or OAuth
  start.
- `login` is called after an authenticated session is established.
- `logout` is called before `reset()` after logout succeeds.
- `subscriptionCancelled` means cancellation intent was accepted. It does not
  mean access has ended.
- `subscriptionExpired` means the entitlement actually ended.
- `paymentSucceeded` means the payment processor confirmed an attempt.
- `purchase` means an order or commercial transaction completed.
- `refund` means a refund was confirmed, not merely requested.

The docs must use these boundaries consistently.

### 6. One authoritative producer per business outcome

Applications must not emit the same outcome from both the client and server.

- Client interaction events such as search and share normally belong in the
  Browser or React Native SDK.
- Durable account, trial, subscription, payment, purchase, and refund outcomes
  should be emitted by the server whenever a server owns that truth.
- A client may emit an outcome after a successful API response when no server
  SDK integration exists, but the source attribution remains visible and the
  event must not be described as a financial ledger entry.
- Webhook retry delivery and business-level deduplication are application
  responsibilities in this task. Prism's existing event-ID idempotency only
  deduplicates delivery retries of the same queued event.

The docs must explicitly warn that a client and a server emitting the same
business outcome produces two accepted events.

### 7. Identity is explicit and concurrency-safe

Client applications use the existing ordered identity flow:

```ts
await prism.identify(user.id, { plan: "free" });
prism.events.signUp({ method: "email" });
```

`signUp`, `login`, and `logout` require an identified user. If neither the
client's current identity nor a per-call actor supplies a user ID, the helper
throws a specific developer-actionable error before queue mutation.

All helpers accept an optional second argument:

```ts
type StandardEventActor = {
  readonly userId: string;
};

prism.events.login({ method: "password" }, { userId: user.id });
```

The actor override applies only to that event. It must not mutate global client
identity, rotate anonymous identity, create a session, or affect a subsequent
event. This is the required concurrency-safe path for a shared Node client.

Browser and React Native docs should prefer `identify()` because it links the
person's surrounding activity. Node docs should prefer the per-call actor
because a process handles concurrent users and must not rely on mutable global
identity.

No helper accepts traits. Use `identify()` separately where a single-user
client owns the identity lifecycle.

### 8. Standard properties are exact and low-cardinality

Standard Event inputs use explicit TypeScript interfaces and strict runtime
validators.

- Reject unknown keys; do not silently drop them.
- Reject `undefined`, non-finite numbers, dates, class instances, arrays where
  an object is required, dangerous keys, and values outside the frozen limits.
- Use bounded stable tokens for methods, flows, plans, channels, roles,
  categories, and reason codes.
- Use integer milliseconds for durations and timestamps.
- Use integer minor currency units, never floating-point money.
- Use uppercase three-letter currency codes.
- Do not accept arbitrary metadata or nested provider payloads.
- Do not merge global custom properties into protected Standard Event
  properties. Identity, session, runtime context, and source attribution still
  attach through their dedicated wire fields.

If an application needs additional detail, it should send a separate custom
event or use a later explicitly versioned Standard Event schema.

### 9. Standard properties are versioned

Every Standard Event uses this exact top-level wire shape:

```ts
type StandardEventWireProperties<TData> = {
  readonly $standard: {
    readonly schemaVersion: 1;
    readonly key: StandardEventKey;
    readonly data: TData;
  };
};
```

The protected name and key must agree:

```text
$prism_sign_up <-> key: sign_up
```

The only top-level property is `$standard`. The only `$standard` keys are
`schemaVersion`, `key`, and `data`. Each event owns an exact `data` schema.

Use schema version `1` for the entire first catalog. A future incompatible
change adds a new schema version and an explicit migration/compatibility
policy; it does not silently reinterpret stored version-1 events.

### 10. Do not add a projection table

The canonical event store already contains everything required for this task.

No migration is expected. Valid Standard Events persist as normal events with:

- the protected name;
- the validated `$standard` properties;
- trusted `source_id` and platform;
- user/person/session attribution when present;
- SDK name/version;
- occurred and received timestamps.

Existing retention, person deletion, project deletion, and source archive
behavior applies automatically. If implementation discovers that a migration
is genuinely required, stop and update this task before adding one.

### 11. Existing Events is the only product surface

Do not add a sidebar item or new page.

The existing Events list and detail view should make Standard Events readable:

- show `Sign up`, `Subscription cancelled`, and similar labels instead of
  presenting only the raw protected name;
- show a small rectangular `STANDARD` metadata label and the event category;
- retain the raw `$prism_*` name in event detail for debugging;
- render the validated data fields using the existing property viewer;
- retain source, person, session, SDK, and timestamp attribution;
- keep existing event-name search working against the stored raw name;
- do not add charts, metric cards, recommendations, or aggregate filters.

The product API may add optional derived metadata to the existing list/detail
resource. It must derive that metadata from the shared registry and never trust
display names supplied by the SDK payload.

## Frozen Standard Event catalog

### Shared vocabulary and limits

Add one shared `STANDARD_EVENT_LIMITS` constant in Core. Slice 1 may tighten a
ceiling before implementation, but it must not widen these limits without a
task update.

| Value | Limit and rule |
| --- | --- |
| Stable token | 1-64 characters; lowercase ASCII letter first; then lowercase letters, digits, `.`, `_`, or `-` |
| Opaque analytics ID | 1-128 ASCII characters matching `[A-Za-z0-9][A-Za-z0-9._:-]*`; no `@`, whitespace, slash, controls, secret, email address, or raw provider payload |
| Plan ID | Stable token, 1-64 characters |
| Reason/failure code | Stable token, 1-64 characters; no free text |
| Currency | Exactly three uppercase ASCII letters |
| Money | Non-negative safe integer in minor units |
| Count | Non-negative safe integer |
| Duration | Non-negative safe integer milliseconds |
| Effective timestamp | Positive safe integer epoch milliseconds |
| Rating | Integer from 1 through 5 |
| Trial duration | Integer from 1 through 3,660 days |

All property objects are readonly in the exported TypeScript contract.

### Identity and access

| SDK helper | Protected name/key | Input | Exact meaning | Producer guidance |
| --- | --- | --- | --- | --- |
| `signUp` | `$prism_sign_up` / `sign_up` | `{ method: StableToken }` | A durable user account was created successfully. Requires identified user or per-call actor. | Prefer the server; otherwise call after the successful account response. |
| `login` | `$prism_login` / `login` | `{ method: StableToken }` | An authenticated user session was established. Requires identified user or per-call actor. | Client or server, but exactly one. |
| `logout` | `$prism_logout` / `logout` | `{ reasonCode?: StableToken }` | The known user's logout completed. Requires identified user or per-call actor. | Call before `prism.reset()` on a client. |

`method` examples include `email`, `password`, `google`, `github`, `apple`,
and `magic_link`. Prism does not own an exhaustive provider enum.

### Onboarding

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `onboardingStarted` | `$prism_onboarding_started` / `onboarding_started` | `{ flowId?: StableToken }` | A user entered an onboarding flow. |
| `onboardingStepCompleted` | `$prism_onboarding_step_completed` / `onboarding_step_completed` | `{ stepId: StableToken; flowId?: StableToken }` | One durable step in the flow completed. |
| `onboardingCompleted` | `$prism_onboarding_completed` / `onboarding_completed` | `{ flowId?: StableToken; durationMs?: number }` | The flow's defined completion condition was reached. |

Do not add `onboardingAbandoned` in version 1. Reliable abandonment requires a
time window and analysis rule; an app-close callback is not dependable enough
to claim it synchronously.

### Acquisition and collaboration

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `leadGenerated` | `$prism_lead_generated` / `lead_generated` | `{ channel?: StableToken; campaignId?: StableToken }` | The application's own lead qualification boundary succeeded. |
| `inviteSent` | `$prism_invite_sent` / `invite_sent` | `{ channel?: StableToken; role?: StableToken }` | A real invitation was created or dispatched successfully. |
| `inviteAccepted` | `$prism_invite_accepted` / `invite_accepted` | `{ channel?: StableToken; role?: StableToken }` | The invite acceptance completed, not merely opened. |

Do not call `leadGenerated` for a page view or button click unless that action
is the product's actual lead boundary.

### Trials

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `trialStarted` | `$prism_trial_started` / `trial_started` | `{ trialId: OpaqueId; planId: StableToken; durationDays?: number }` | Trial access became active. |
| `trialEnded` | `$prism_trial_ended` / `trial_ended` | `{ trialId: OpaqueId; planId: StableToken; outcome: "converted" \| "expired" \| "cancelled" }` | The trial reached one final outcome. |

Do not emit both `trialEnded({ outcome: "converted" })` and a second
trial-converted Standard Event. The outcome is the canonical final state.

### Subscriptions

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `subscriptionStarted` | `$prism_subscription_started` / `subscription_started` | `{ subscriptionId: OpaqueId; planId: StableToken; billingInterval?: "month" \| "year" \| "other" }` | Paid or otherwise entitled subscription access became active. |
| `subscriptionRenewed` | `$prism_subscription_renewed` / `subscription_renewed` | `{ subscriptionId: OpaqueId; planId: StableToken; billingInterval?: "month" \| "year" \| "other" }` | An existing subscription renewed successfully. |
| `subscriptionChanged` | `$prism_subscription_changed` / `subscription_changed` | `{ subscriptionId: OpaqueId; fromPlanId: StableToken; toPlanId: StableToken }` | An active subscription changed plan. The plan IDs must differ. |
| `subscriptionPaused` | `$prism_subscription_paused` / `subscription_paused` | `{ subscriptionId: OpaqueId; planId: StableToken; reasonCode?: StableToken }` | Subscription access entered a paused state. |
| `subscriptionResumed` | `$prism_subscription_resumed` / `subscription_resumed` | `{ subscriptionId: OpaqueId; planId: StableToken }` | A paused subscription returned to active. |
| `subscriptionCancelled` | `$prism_subscription_cancelled` / `subscription_cancelled` | `{ subscriptionId: OpaqueId; planId: StableToken; reasonCode?: StableToken; effectiveAtMs?: number }` | Cancellation intent was accepted. Access may remain active until `effectiveAtMs`. |
| `subscriptionExpired` | `$prism_subscription_expired` / `subscription_expired` | `{ subscriptionId: OpaqueId; planId: StableToken; reasonCode?: StableToken; endedAtMs?: number }` | Subscription entitlement ended. |

Cancellation and expiration must remain separate. A cancellation scheduled for
the end of a billing period is not an expiration until access actually ends.

### Payments and commerce

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `paymentSucceeded` | `$prism_payment_succeeded` / `payment_succeeded` | `{ transactionId: OpaqueId; valueMinor: number; currency: Currency; provider?: StableToken }` | A payment attempt was confirmed successful. |
| `paymentFailed` | `$prism_payment_failed` / `payment_failed` | `{ transactionId: OpaqueId; valueMinor?: number; currency?: Currency; provider?: StableToken; failureCode?: StableToken }` | A payment attempt reached a confirmed failure. `valueMinor` and `currency` must be supplied together or both omitted. |
| `purchase` | `$prism_purchase` / `purchase` | `{ transactionId: OpaqueId; valueMinor: number; currency: Currency; itemCount?: number }` | An order or commercial transaction completed. |
| `refund` | `$prism_refund` / `refund` | `{ refundId: OpaqueId; transactionId: OpaqueId; valueMinor: number; currency: Currency; reasonCode?: StableToken }` | A refund was confirmed for a completed transaction. |

`paymentSucceeded` and `purchase` are different facts. Some products use only
one. If both are emitted for the same checkout, they remain two events and
must never be summed together as one revenue measure in future work.

Money examples:

```ts
prism.events.purchase({
  transactionId: "order_2026_1042",
  valueMinor: 1299,
  currency: "USD",
  itemCount: 2,
});
```

`1299` means USD 12.99. Do not accept `12.99` as money.

### Engagement and feedback

| SDK helper | Protected name/key | Input | Exact meaning |
| --- | --- | --- | --- |
| `search` | `$prism_search` / `search` | `{ category?: StableToken; resultCount?: number }` | A user submitted an in-product search. |
| `share` | `$prism_share` / `share` | `{ method: StableToken; contentType?: StableToken }` | A share action completed through the chosen method. |
| `feedbackSubmitted` | `$prism_feedback_submitted` / `feedback_submitted` | `{ kind?: StableToken; rating?: 1 \| 2 \| 3 \| 4 \| 5 }` | A feedback submission completed. |

Version 1 deliberately excludes raw search text, shared content IDs, feedback
text, and support messages. Those values can contain personal data, secrets,
or high-cardinality content.

## Public SDK contract

### Shared types

Add the public types to a focused Core module such as
`packages/core/src/standard-events.ts` and export them through Core's package
entry point.

The direction is:

```ts
export type StandardEventKey =
  | "sign_up"
  | "login"
  | "logout"
  | "onboarding_started"
  | "onboarding_step_completed"
  | "onboarding_completed"
  | "lead_generated"
  | "invite_sent"
  | "invite_accepted"
  | "trial_started"
  | "trial_ended"
  | "subscription_started"
  | "subscription_renewed"
  | "subscription_changed"
  | "subscription_paused"
  | "subscription_resumed"
  | "subscription_cancelled"
  | "subscription_expired"
  | "payment_succeeded"
  | "payment_failed"
  | "purchase"
  | "refund"
  | "search"
  | "share"
  | "feedback_submitted";

export interface StandardEventActor {
  readonly userId: string;
}

export interface PrismStandardEvents {
  signUp(
    input: Readonly<SignUpProperties>,
    actor?: Readonly<StandardEventActor>,
  ): CaptureResult;
  // The remaining catalog follows the same exact pattern.
}

export interface PrismClient {
  readonly events: PrismStandardEvents;
  // Existing fields and methods remain unchanged.
}
```

Requirements:

- `events` object identity is stable for the lifetime of the client.
- Every helper method identity is stable and already bound.
- Calls are synchronous, like `track()`.
- Invalid input throws before queue mutation.
- Consent, queue-full, and shutdown outcomes return the existing dropped
  result.
- A queued helper returns the generated event ID.
- The helper never mutates its input or actor object.
- The helper validates before sanitization, then queues the normalized exact
  schema.
- Protected properties bypass global-property merging.
- Helper implementation goes through one shared capture function, not 25
  copies of queue logic.

### Actor behavior

The shared capture function resolves the event user in this order:

1. `actor.userId` supplied to this call;
2. the current `client.identity.userId`;
3. no external user ID.

For `signUp`, `login`, and `logout`, step 3 throws. For every other event, an
anonymous or sessionless event is valid.

An actor override does not queue an identity operation. It only sets the
immutable `userId` field on this event. Existing ingestion resolves that field
to the project-scoped person as it does for other version-3 events.

### Browser and React Native

Browser and React Native clients inherit `PrismClient.events` from Core.

- Do not wrap or recreate the namespace in either adapter.
- Do not create new listeners or lifecycle ownership.
- Browser page tracking and React Native screen/lifecycle capture remain
  unchanged.
- Adapter package declarations and packed output must expose the inherited
  types.

### React

Add `events` to `PrismReactFacade` and return the existing client namespace
from `createFacade()`:

```ts
const prism = usePrism();

await prism.identify(user.id);
prism.events.signUp({ method: "email" });
```

Both `usePrism()` and `useOptionalPrism()` must expose the same stable object.
Do not add one hook per event.

### Node/server

`packages/node/src/node-runtime.ts` already implements a Core runtime adapter.
Expose it through a public analytics factory instead of asking Node consumers
to assemble private Core seams.

```ts
import { createNodeClient } from "@prism-analytics/node";

const prism = await createNodeClient({
  sourceKey: process.env.PRISM_SOURCE_KEY!,
  endpoint: process.env.PRISM_ENDPOINT!,
  collection: { initialState: "granted" },
});

prism.events.subscriptionCancelled(
  {
    subscriptionId: subscription.analyticsId,
    planId: "pro_monthly",
  },
  { userId: user.id },
);
```

Requirements:

- `createNodeClient()` is a thin wrapper over `createPrismClient()` and
  `createNodeRuntime()`; it does not implement a second queue.
- Require an explicit endpoint and source key.
- Require an explicit initial collection state; do not silently assume consent.
- Use a server source key. Source platform remains server-authoritative at
  ingestion.
- Node event examples use the per-call actor and never mutate shared client
  identity inside concurrent request handling.
- Replace the runtime adapter's `Math.random()` ID fallback before making this
  factory public. Use a cryptographically secure Node implementation or fail
  loudly when unavailable.
- Keep `flush()` and bounded `shutdown()` available for tests, jobs, and
  graceful process termination.
- Do not install `uncaughtException` or `unhandledRejection` handlers.

The task does not add Stripe, Paddle, RevenueCat, or other provider-specific
helpers.

## Shared registry and validation

Create one frozen registry in Core that is usable at SDK capture, analytics
ingestion, and product API presentation boundaries.

Each entry must include at least:

```ts
type StandardEventDefinition = {
  readonly key: StandardEventKey;
  readonly protectedName: `$prism_${string}`;
  readonly sdkMethod: keyof PrismStandardEvents;
  readonly displayName: string;
  readonly category:
    | "Identity"
    | "Onboarding"
    | "Acquisition"
    | "Trials"
    | "Subscriptions"
    | "Payments"
    | "Engagement";
  readonly schemaVersion: 1;
  readonly requiresUser: boolean;
};
```

The registry is the source of truth for:

- protected name to Standard Event key lookup;
- SDK helper to protected name mapping;
- display label and category;
- user requirement;
- exact version-1 validator dispatch;
- docs/test completeness assertions.

Do not let an SDK payload choose its own display name, category, requirement,
or validator.

Validation result direction:

```ts
type StandardEventValidationResult =
  | {
      readonly ok: true;
      readonly key: StandardEventKey;
      readonly value: StandardEventWireProperties<unknown>;
    }
  | {
      readonly ok: false;
      readonly reason: string;
    };
```

The successful value is a new normalized object. Validators do not mutate or
return the caller's object reference.

## Ingestion contract

Extend the current protected-event pass in
`apps/analytics-api/src/controllers/IngestController.ts`.

For every structurally valid event whose name starts with `$prism_`:

1. Dispatch existing automatic event names to their existing validators:
   `$prism_page_view`, `$prism_screen_view`, and
   `$prism_app_lifecycle`.
2. Dispatch a recognized Standard Event name to the shared Standard Event
   validator.
3. Reject every other protected name with `unknown-reserved-event`.
4. Reject a malformed recognized Standard Event with
   `invalid-standard-event`.
5. Exclude rejected events from the persistence transaction exactly like the
   current page/mobile rejection path.
6. Persist only the validator's normalized value.
7. Preserve submitted result order in mixed valid/rejected batches.
8. Never echo event properties, identifiers, values, or schema details in the
   response or logs.

Standard Events are permitted from current creatable source platforms `web`,
`react-native`, and `server`. Trusted source/platform attribution continues to
come from the authenticated key, never the payload.

The first release does not claim financial verification based only on the
event name. The source metadata honestly shows whether the record came from a
Web, Mobile, or Server source.

## Product API and Events representation

Extend the existing event resources with optional derived metadata:

```ts
export type StandardEventAttribution = {
  key: StandardEventKey;
  displayName: string;
  category: string;
  schemaVersion: 1;
};

export type EventListItemResource = {
  // Existing fields.
  standardEvent: StandardEventAttribution | null;
};
```

Use the same nullable field on event detail.

Rules:

- The API derives it from the stored protected name and shared registry.
- It is `null` for custom events, session records, malformed legacy records,
  and non-Standard automatic protected events.
- The raw stored event name remains available.
- Existing consumers must either receive an explicitly nullable field or a
  backward-compatible optional field during the rollout. Freeze one shape in
  Slice 1 and update all call sites together.
- No new read endpoint is required.

Events list treatment:

```text
Sign up                 STANDARD · IDENTITY
$prism_sign_up          Acme web · Web          2m ago
```

Use the existing density, typography, focus, table, and detail-sheet patterns.
Do not introduce a new card or promotional panel. The raw name may stay in the
detail metadata rather than taking a second line in a narrow table if the final
layout is clearer.

## Documentation requirements

### Dedicated Standard Events page

Add `apps/docs/content/docs/features/standard-events.mdx` and register it in
the Features metadata in the simplified docs structure.

The page must contain:

1. The distinction between custom, Standard, and automatic events.
2. The Browser/React identity-first sign-up example.
3. The concurrency-safe Node per-call actor example.
4. The complete helper catalog grouped as in this task.
5. Exact TypeScript input fields and required/optional markers.
6. The successful business boundary for every helper.
7. Client-versus-server producer guidance.
8. Cancellation-versus-expiration semantics.
9. Payment-versus-purchase semantics.
10. Integer minor-unit currency examples.
11. A warning against duplicate client/server emission.
12. Privacy guidance for IDs, reason codes, search, and feedback.
13. `CaptureResult`, validation-error, consent, delivery, and retry behavior.
14. How Standard Events appear in the existing Events page.

### Existing docs to reconcile

Update at least:

- `features/capturing-events.mdx` to introduce Standard Events and link to the
  catalog;
- `start/quickstart.mdx` to replace the current custom
  `signup_completed` example with `identify()` plus `events.signUp()`, and to
  correct its current claim that `track()` never throws (invalid caller input
  throws; delivery-state drops return a result);
- `start/javascript-sdk.mdx` with one Browser example;
- `start/react-sdk.mdx` with one `usePrism().events` example;
- `start/react-native.mdx` with one mobile Standard Event example;
- `start/node-sdk.mdx` with `createNodeClient()` and a server-owned outcome;
- `reference/sdk-api-and-limits.mdx` with the namespace, actor override, exact
  limits, protected prefix, and return behavior;
- package READMEs and CHANGELOGs for Core, Browser, React, React Native, and
  Node.

Docs must not claim that Standard Events already power AI, conversion metrics,
revenue reports, or widgets. They appear in Events in this task.

## Implementation checklist

The implementation is contracts-first. Keep each slice reviewable and use one
commit per slice. Do not mark later slices complete because a scaffold compiles.

Before implementation, read the repository `AGENTS.md` plus the `api-design`,
`tdd-workflow`, `security-review`, and `docs-writer` skills. Read the React
patterns skill before the product UI slice.

### Slice 1: Freeze the registry, types, schemas, and fixtures

- [ ] Add the complete `StandardEventKey` union and protected-name constants.
- [ ] Add readonly input interfaces for every helper in the catalog.
- [ ] Add `StandardEventActor`, `PrismStandardEvents`, wire-property, registry,
  category, and validation-result types.
- [ ] Add `STANDARD_EVENT_LIMITS` and exact reusable scalar validators.
- [ ] Add one exact event validator per schema or a focused schema table with
  equally readable per-event failures.
- [ ] Assert that registry keys, helper methods, protected names, display
  labels, categories, and validators form a one-to-one complete set.
- [ ] Add deterministic valid and invalid fixtures for every event.
- [ ] Freeze the optional/nullable `standardEvent` API resource shape.
- [ ] Add RED tests before runtime implementation.
- [ ] Record any catalog change in this task before continuing.

### Slice 2: Implement the Core Standard Event namespace

- [ ] Add one shared internal capture path for Standard Events.
- [ ] Attach one stable `events` object to each ready `PrismClient`.
- [ ] Validate helper input and actor before queue mutation.
- [ ] Enforce the identity requirement for sign-up, login, and logout.
- [ ] Implement the per-call actor override without mutating client identity.
- [ ] Prevent global custom properties from entering `$standard` properties.
- [ ] Preserve normal consent, queue, event-ID, session, context, diagnostic,
  flush, and shutdown behavior.
- [ ] Keep public `track("$prism_...")` rejection unchanged.
- [ ] Export all public types/constants through Core.
- [ ] Test stable object/method identity and input immutability.
- [ ] Test identify-then-event ordering and actor isolation across adjacent
  events.

### Slice 3: Expose the helpers through Browser, React, React Native, and Node

- [ ] Verify Browser inherits the Core namespace without adapter-owned logic.
- [ ] Add the stable namespace to `PrismReactFacade`.
- [ ] Verify both React hooks return the same namespace for the same client.
- [ ] Verify React Native inherits it without changing lifecycle/screen capture.
- [ ] Export a public Node `createNodeClient()` around the existing runtime.
- [ ] Remove the insecure Node ID fallback before exposing the factory.
- [ ] Verify per-call Node actors are safe under interleaved concurrent calls.
- [ ] Add package declaration and CJS/ESM consumer tests.
- [ ] Update package versions coherently under the repository's release policy.

### Slice 4: Enforce protected contracts at ingestion

- [ ] Extend ingestion reject reasons with coarse Standard Event outcomes.
- [ ] Dispatch every known Standard Event to the shared validator.
- [ ] Reject unknown `$prism_*` names.
- [ ] Preserve existing page/mobile protected validators and projections.
- [ ] Persist the normalized Standard Event value, never the raw invalid input.
- [ ] Preserve ordered mixed-batch outcomes.
- [ ] Verify trusted source/platform still comes only from the key.
- [ ] Verify valid events persist as canonical `events` rows with no new table.
- [ ] Verify invalid protected events persist nothing.
- [ ] Add real-sqld tests for Web, React Native, and Server sources.

### Slice 5: Add readable Standard Events to the existing Events experience

- [ ] Derive `standardEvent` metadata in the canonical list and detail API.
- [ ] Keep raw names and existing source/identity/session/SDK fields intact.
- [ ] Render a readable label, `STANDARD` metadata, and category in Events.
- [ ] Retain custom and automatic event rendering unchanged.
- [ ] Ensure direct event-name search still finds protected raw names.
- [ ] Cover list, detail, loading, and mixed-event rendering.
- [ ] Verify keyboard and screen-reader output communicates the display label
  and category without relying on color.
- [ ] Add no new route, sidebar link, chart, card, or aggregate query.

### Slice 6: Publish docs and packed-package proof

- [ ] Add the dedicated Standard Events documentation page.
- [ ] Reconcile all existing docs listed above.
- [ ] Update package READMEs and CHANGELOGs.
- [ ] Replace misleading signup custom-event examples.
- [ ] Add a packed Browser/React fixture proving identify plus sign-up.
- [ ] Add a packed React Native fixture proving one engagement event.
- [ ] Add a packed Node fixture proving an interleaved actor-safe subscription
  event and bounded flush.
- [ ] Verify all examples compile against tarballs, not workspace source aliases.
- [ ] Verify no docs promise future AI or aggregate features.

### Slice 7: Complete focused quality and hosted proof

- [ ] Run Core, Browser, React, React Native, Node, Types, analytics-api, API,
  Web, and Docs tests relevant to changed contracts.
- [ ] Run repository typecheck, lint, and build gates.
- [ ] Run dependency audit and document any accepted non-production advisory.
- [ ] Create a hosted test source for Web and Server paths without committing
  real keys.
- [ ] Capture sign-up, onboarding completion, subscription cancellation,
  payment failure, search, and feedback examples.
- [ ] Confirm they appear once, under the correct project/source/person, with
  readable Events labels and exact safe properties.
- [ ] Confirm an unknown or malformed protected event is rejected and absent.
- [ ] Append commands, counts, environment, and actual results to the progress
  log. Do not record expected evidence as completed evidence.

## Focused test matrix

### Contract and validation tests

- every registry member has exactly one key, protected name, helper, display
  name, category, version, and validator;
- every valid minimum and full fixture normalizes to the exact wire shape;
- every unknown key, wrong type, invalid token, excessive string, unsafe
  integer, invalid currency, mismatched optional pair, and conflicting plan is
  rejected;
- `subscriptionChanged` rejects equal from/to plan IDs;
- `paymentFailed` requires `valueMinor` and `currency` together;
- raw search text, feedback text, provider payloads, and arbitrary metadata are
  not part of any public input type or accepted runtime shape;
- validators create new objects and never mutate inputs.

### SDK behavior tests

- each helper emits its exact protected name/key/version;
- public `track()` rejects every protected catalog name;
- missing identity fails loudly for sign-up, login, and logout;
- `identify()` followed immediately by sign-up attaches the known user;
- an actor override affects only its event under interleaved calls;
- global properties do not widen Standard Event properties;
- consent pending/denied, queue-full, and shutdown return normal dropped results;
- a queued result carries an event ID and delivers through the existing batch;
- Browser, React, React Native, and Node surfaces expose stable helpers.

### Ingestion and real-store tests

- all catalog events are accepted from authenticated current source platforms;
- unknown `$prism_*` and malformed recognized events are individually rejected;
- rejected protected entries never persist in a mixed batch;
- accepted properties are normalized and stored once;
- source ID/platform cannot be overridden by properties;
- event retry with the same event ID is duplicate, not a second row;
- user/person/session attribution follows current Task 10 rules;
- existing page and mobile protected-event behavior does not regress;
- project/person deletion and retention remove Standard Events through the
  existing canonical event boundaries.

### API and Web tests

- custom events return `standardEvent: null`;
- valid Standard Events receive correct derived metadata;
- automatic page/mobile events do not masquerade as Standard Events;
- list and detail retain raw names and exact attribution;
- mixed rows render correctly at mobile and desktop widths;
- the accessible name communicates the Standard Event label and category.

### Documentation and package tests

- all catalog helpers occur in the dedicated docs page;
- code samples typecheck against packed package artifacts;
- Browser/React, React Native, and Node examples produce the documented shape;
- no example uses a real key, email, transaction provider payload, or secret;
- no task-19 docs claim analytics/AI behavior outside this scope.

## Security and privacy requirements

- Treat source keys as credentials. Never print, fixture, screenshot, or commit
  a real value.
- Derive project/source/platform only from the authenticated key.
- Keep the protected namespace closed. Unknown `$prism_*` values fail closed.
- Validate at the SDK and again at ingestion; TypeScript is not a trust
  boundary.
- Never log Standard Event properties, actor IDs, transaction IDs,
  subscription IDs, reason codes, or malformed payload fragments.
- `userId`, transaction, refund, trial, and subscription IDs are opaque
  developer-owned identifiers. Docs must forbid emails, names, secrets, card
  data, provider tokens, and raw webhook payloads.
- Apply the existing credential redaction and strict JSON policy before
  persistence.
- Do not accept free-text cancellation reasons, failure messages, search terms,
  feedback bodies, or shared content.
- Keep money as safe integer minor units and reject negative/non-finite values.
- The Node actor override must be event-local so one request cannot relabel
  another request's event.
- Existing project authorization protects event reads; no public aggregate
  endpoint is added.
- Existing person/project deletion and retention semantics remain authoritative.

## Performance and compatibility requirements

- Helper calls remain synchronous and bounded by the same event-size work as
  `track()`.
- Registry lookup and validation are bounded by the fixed catalog.
- Do not add network calls, storage reads, or dynamic imports to a helper call.
- Do not add one module-level listener or timer per helper.
- Measure Core and adapter package-size changes against current packed output.
  A meaningful increase requires an explanation in the progress log.
- Preserve CJS and ESM Node imports and Metro-safe React Native imports.
- Keep Browser and React tree-shaking behavior reasonable; do not ship docs or
  dashboard presentation code in SDK packages.
- Existing custom, page, screen, lifecycle, session, identity, and error paths
  must remain backward-compatible.

## Non-goals and deliberately deferred events

Do not add these in version 1:

- `accountDeleted`: person deletion and audit semantics need a separate privacy
  decision;
- `onboardingAbandoned`: abandonment is derived over time, not a reliable
  synchronous outcome;
- `checkoutCompleted`: it overlaps `purchase` without adding a stable fact;
- add/remove cart events: commerce analysis is outside the initial Prism
  product boundary;
- push notification, deep-link, permission, or ad events: they need a separate
  mobile-notification contract;
- raw search terms or feedback bodies: privacy and high cardinality are not
  justified;
- provider-specific Stripe/RevenueCat/Paddle states;
- dynamic user-created Standard Event definitions;
- dashboards, aggregates, alerts, AI, and recommendations.

If a later task needs one of these, it must define the meaning, producer,
schema, privacy boundary, and compatibility story explicitly.

## Definition of done

- [ ] The 25-event catalog is frozen and complete across types, registry,
  validators, helpers, docs, and tests.
- [ ] Core exposes one stable `prism.events` namespace with exact typed inputs.
- [ ] Browser and React Native inherit the helpers without duplicate delivery
  machinery.
- [ ] React exposes the same stable namespace through both Prism hooks.
- [ ] Node exposes a secure public analytics factory and concurrency-safe
  per-event actor path.
- [ ] Public `track()` cannot forge a Standard Event.
- [ ] Ingestion rejects unknown/malformed protected records and stores only
  normalized valid events.
- [ ] Valid Standard Events remain canonical events; no projection table or new
  analytics endpoint exists.
- [ ] Existing Events list/detail shows readable Standard Event metadata while
  retaining raw names and attribution.
- [ ] The dedicated docs page describes every event, boundary, input, producer,
  privacy rule, and failure behavior.
- [ ] Quickstart and SDK docs use accurate examples.
- [ ] Packed Browser/React, React Native, and Node consumers pass.
- [ ] Focused unit, integration, real-store, UI, typecheck, lint, build, audit,
  and hosted proof gates pass with recorded evidence.
- [ ] AI, insights widgets, aggregate reports, and new dashboard pages remain
  absent from this task.

## Progress log

### 2026-09-01 - task created

- Standard Events were separated from the future AI Insights work.
- The initial catalog, public helper namespace, protected wire schema, actor
  semantics, ingestion boundary, Events representation, docs requirements,
  implementation slices, and closure gates were frozen for handoff.
- No implementation was performed as part of task creation.
