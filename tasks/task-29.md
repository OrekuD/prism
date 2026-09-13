# Task 29: Enforce source-family compatibility and identify key families

**Status:** Planned; contract and rollout decisions precede implementation  
**Created:** September 13, 2026  
**Depends on:** Task 13 source/key model; relevant Tasks 15–19 SDK contracts  
**Supports:** [Task 22](task-22.md) source-readiness proof and
[Task 23](task-23.md) trustworthy correlation

**Development-only cutover:** Existing keys and older SDK payload formats do
not need backward compatibility. Replace them rather than build migration
windows, legacy exceptions, or fallback authentication paths.

Prevent accidental use of a source key with an incompatible SDK. Give newly
issued keys readable family prefixes, validate compatibility during SDK
initialization, and enforce the same policy at ingestion for all telemetry.
Keep one logical product project with Web, Mobile, and Server sources. One
Mobile source and key can serve React Native and future native iOS/Android
SDKs. Multiple sources of the same family remain available for separate
configuration or rotation; SDK choice alone does not require another source.

## Current behavior confirmed in code

Reinspect these files before editing because adjacent implementation and
redesign work are active.

- `apps/api/src/utils/generateApiKey.ts` currently issues `psk_` or `ssk_`
  followed by a UUID-derived suffix. It identifies key class, not platform.
- `apps/api/src/controllers/SourcesController.ts` calls the generator for
  source creation and additional keys. Inspect masking and reveal paths too.
- `packages/core/src/validation.ts` checks that a key is nonempty, not that it
  matches the adapter or a valid source.
- `apps/analytics-api/src/middlewares/AnalyticsMiddleware.ts` authenticates the
  key and derives source/project/platform from storage. Origin enforcement is
  currently specific to publishable Web sources.
- `IngestController.ts` rejects Web page views on non-Web sources, but ordinary
  custom and valid Standard Events don't have equivalent SDK compatibility
  enforcement. A browser can therefore send them under React Native attribution.
- Inspect `ErrorIngestController.ts`, session/identity writes, SDK descriptors,
  WebSocket authentication, and both key lookup stores. Don't fix only page views.

## Product and security decisions

Source family, SDK identity, OS, and key class are separate. These are the
agreed formats for implementation, not a claim of current SDK support.

| Source family | Compatible SDKs | Key class | Prefix |
| --- | --- | --- | --- |
| `web` | Browser; React through Browser | Publishable | `psk_web_` |
| `mobile` | React Native; future native iOS and Android | Publishable | `psk_mobile_` |
| `server` | Node; explicit server integration | Secret | `ssk_` |

Secret ingestion keys are exclusively Server keys, so no additional server
suffix is needed. Do not introduce SDK-specific Mobile key prefixes. Future
native SDKs use the same Mobile key once their adapters and ingestion contracts
are supported; this task does not implement or advertise those SDKs as ready.

- Make family the source's compatibility boundary. SDK name/version and OS
  belong to telemetry metadata, not the credential. A Mobile source must not
  lock to whichever SDK or OS sends its first event.
- A source family is immutable after creation. Changing Web to Mobile requires
  another source, not relabeling historical rows. Converting the old mobile
  source taxonomy to the new family model is a separate structural cutover.
- Keep publishable versus secret semantics obvious. Server keys must not be
  embedded in browser or mobile apps, regardless of prefix.
- A prefix is a readable hint, not authentication. Altering a prefix must not
  turn a key into a valid credential or change its source.
- An SDK/runtime declaration is also untrusted. This feature detects mistakes;
  it does not attest that a request came from a genuine device or SDK.
- Retain server-derived project/source scope, revocation, origin policy,
  consent, and ingestion-only permissions. Never trust prefix/body scope instead.

## Slice 1: Inventory and freeze one shared policy

Create a shared, environment-neutral policy consumed by adapters and servers.

- [ ] Inventory actual SDK names/versions, batch descriptors, error envelopes,
  bootstrap endpoints, legacy payloads, and source platform mutability.
- [ ] Freeze source-family→compatible SDK mappings and prefix parsing.
  React must resolve to Browser compatibility, not require a React-only source.
- [ ] Replace SDK-specific source creation choices with Web, Mobile, and Server.
  Define how the existing `platform` column/API maps to a canonical family;
  update schemas, source resources, selectors, and authorization context together.
- [ ] Map existing `react-native`, `ios`, and `android` source records to Mobile
  without merging their IDs, keys, or configuration. Preserve known historical
  SDK/OS attribution separately; do not fabricate missing metadata.
- [ ] Audit event filters, analytics projections, assistant capability detection,
  setup snippets, and error grouping for assumptions that source platform equals
  SDK or OS. Freeze historical read/grouping behavior before changing those fields.
- [ ] Define declared runtime/adapter metadata for every telemetry lane. Generic
  Core integrations must declare their integration type explicitly; Core cannot
  infer a runtime from its own package name or accept arbitrary platform claims.
- [ ] Define manual HTTP integration support and its required declaration.
  Don't accidentally prohibit documented server ingestion without a Node SDK.
- [ ] Freeze stable errors for invalid/revoked credentials, incompatible source,
  missing/unsupported descriptor, and temporary validation unavailability.
- [ ] Specify full-request versus per-item failures. Incompatible batch SDK
  metadata rejects the whole batch before event, session, identity, error, or
  projection writes; existing event-specific schema errors remain positional.
- [ ] Freeze the exact prefix grammar and required descriptor before issuing keys.

## Slice 2: Key generation and storage

Change issuance without changing source ownership. Replace old development
credentials with freshly generated keys; don't just prepend a new prefix.

- [ ] Generate prefixes from the stored source family and allowed key class,
  not a caller-controlled prefix. Reject impossible class/family pairings.
- [ ] Use at least 32 cryptographically random bytes for new suffixes. Keep
  readable prefixes outside the random entropy; don't derive keys from IDs.
- [ ] Update source-create, additional-key, rotation, validation, masking,
  one-time reveal, copy, and setup-example paths together.
- [ ] Inspect current secret digest/plaintext migration work in Task 16 first.
  Preserve its intended storage guarantees; don't add a new reversible copy
  of a secret to support prefix detection or compatibility lookup.
- [ ] Keep prefixes visible in masked secret displays. Never print full keys
  in diagnostics, test output, screenshots, or migration evidence.
- [ ] Authenticate the complete credential, including prefix. If lookup uses a
  digest, digest the complete key; don't strip/change prefixes to try aliases.
- [ ] Replace existing development keys using the new generator and invalidate
  old credentials. Keep source/project records and telemetry intact; this is
  a key-format cutover, not a database reset.

## Slice 3: SDK initialization and configuration checks

Fail early with useful messages without making telemetry capable of crashing
the host app unpredictably.

- [ ] Parse known new prefixes locally before installing listeners or opening
  persistence/queues. Reject definite adapter mismatches and secret keys in
  client adapters with no telemetry queued or transmitted.
- [ ] Add or extend a key-authenticated configuration endpoint on the ingestion
  service so customer apps don't need a dashboard session. Use Authorization,
  never a URL query parameter, for the credential.
- [ ] Return minimal source compatibility and policy-version information, not
  workspace memberships, secrets, or unrelated project configuration.
- [ ] Validate actual stored family/class and Web origins at this boundary.
  Local prefix validation is not a substitute for server lookup.
- [ ] Specify async factory and React-provider loading/failure behavior. Keep
  the existing stable facade and avoid duplicate requests during React remounts.
- [ ] Define offline startup explicitly: bounded cached compatibility may allow
  collection under existing consent rules, but it grants no ingestion authority.
  If no usable result exists, initialization must expose a documented recoverable
  state, not silently claim the source is valid. Bound retries and timeouts.
- [ ] Scope any cache to endpoint, credential identity, adapter, and policy
  version; avoid creating another persistent plaintext secret copy. Rotation,
  endpoint changes, or adapter changes must not reuse unrelated validation.
- [ ] Continue to send the frozen SDK/runtime descriptor on analytics, identity,
  session, and error lanes; server ingestion rechecks even after initialization.
- [ ] Surface source mismatch through diagnostics/error callbacks with guidance:
  “This key belongs to a Mobile source. Use a Web source key.” Never echo
  the credential. A definite mismatch is not a transient retry loop.

## Slice 4: Enforce every ingestion boundary

Use a common compatibility decision after authenticating the actual key.

- [ ] Check request SDK/runtime against the stored source family before writes.
  Cover custom events, Standard Events, page views, screen/lifecycle records,
  identity-only batches, session updates, and error ingestion.
- [ ] Reconcile reserved-event restrictions with the family model: page views
  require Web; mobile screen/lifecycle events require Mobile plus a supported
  adapter and valid event schema. Don't retain a `react-native` source-only
  condition that would block future native adapters using the same Mobile key.
- [ ] Preserve SDK-specific validation and an explicit supported-adapter registry.
  A valid Mobile key does not make an unknown adapter or event shape supported.
- [ ] Preserve authenticated rate/origin checks and non-disclosing unknown-key
  errors. Invalid keys must not reveal their supposed source metadata.
- [ ] Reject mismatched prefixes versus stored family/class rather than
  reclassifying the stored source. Treat inconsistency as a configuration fault.
- [ ] Audit realtime key/token paths for equivalent assumptions. Do not broaden
  live read privileges or add a write-key path to analytics read APIs.
- [ ] Record bounded reason counters without rejected raw payloads. A failed
  batch must produce no analytics/identity/error rows or Live broadcasts.

## Slice 5: Clean development cutover

Prism is still in development. No legacy-key support, dual-format rollout,
compatibility window, or old-SDK exception is required.

- [ ] Require the new key format and SDK/runtime descriptor from the start.
  Reject obsolete publishable formats and missing/incompatible descriptors.
  Server keeps `ssk_`: invalidate old credentials by their stored records, not
  by rejecting that prefix. Enforce the newly agreed suffix grammar too.
- [ ] Update server validation, all supported SDKs, fixtures, seed scripts,
  examples, and setup snippets together. Don't preserve obsolete contracts
  merely to keep old tests green.
- [ ] Provide a scoped development key-regeneration command or procedure. Never
  dump secret values into logs; use the existing secure reveal/setup workflow.
- [ ] Update the relevant development apps/configuration with replacement keys
  and compatible SDK builds. Never commit real credentials.
- [ ] Document the breaking development change and which services/apps need
  restarting. No compatibility feature flags or legacy prefix aliases.
- [ ] Keep external deploys and credential changes separately authorized; this
  task-file edit does not itself rotate keys or change deployed services.
- [ ] Don't rewrite historical misattributed telemetry automatically. Document
  the limitation; any repair requires separate evidence and authorization.

## Layout and docs

Use existing Sources/key surfaces and preserve the ongoing redesign.

- [ ] Show family, SDK compatibility, and key class near setup instructions.
  Mobile setup offers supported SDK instructions without changing source/key.
  Distinguish SDK and OS in telemetry displays; don't label all Mobile data RN.
- [ ] Show family prefixes in examples and masked values, with copy controls
  preserving the exact actual key. Never manufacture a key by replacing text.
- [ ] Explain how to create a compatible source in the same project when a key
  mismatch occurs. Don't suggest creating a second project for the same product.
- [ ] Update Browser, React, React Native, Node, manual ingestion, source setup,
  key rotation, and troubleshooting docs. Keep future native SDKs marked future.
- [ ] Read docs-writer for documentation and applicable design/accessibility
  skills for UI. Read api-design and security-review for the boundary changes.
  Coordinate ownership of currently edited Sources components; no sidebar redesign.

## Verification and acceptance

Write failing-first regressions, then prove the full supported pairing matrix.

- [ ] Browser and React with Web keys succeed; React Native with Mobile keys succeeds
  on iOS/Android; Node with Server keys succeeds.
- [ ] Prove the same Mobile key accepts supported iOS and Android RN traffic
  with distinct OS metadata and no first-SDK/OS lock. Add future-native policy
  fixtures proving no new prefix/source is needed when support is registered;
  do not claim a real native SDK integration test before those SDKs exist.
- [ ] Test all incompatible pairings on initialization and direct HTTP ingestion,
  including valid custom/Standard Events and identity-only/error batches.
- [ ] Assert mismatches persist no telemetry, identity links, or people; no
  partial side effects occur merely because another event in the batch is valid.
- [ ] Test prefix tampering, family/class inconsistencies, revoked keys,
  disallowed origins, unknown/missing descriptors, rejection of old formats,
  and offline recovery.
- [ ] Prove shared error policies and adapter methods don't diverge across SDKs.
- [ ] Run real-store tests and packed-package initialization tests, then an
  approved hosted Web/RN/Server setup flow. Do not substitute mocks for proof.
- [ ] Record actual deployment/SDK versions and development cutover results
  here. Link results into Task 22's source-readiness evidence without marking
  unrelated incomplete SDK or redesign work complete.

Completion means accidental cross-platform use fails clearly, accepted data
retains server-authoritative attribution, and new key prefixes are readable
without weakening secret handling. Only the new development contract is supported.

## Progress log

### 2026-09-13 — Slices 1–4 implemented; Slice 5 tooled, not executed

**Frozen contract** (implemented once in `packages/core/src/source-family.ts`,
consumed by every SDK and by ingestion):

- Families `web | mobile | server`; legacy platform values
  (`react-native | ios | android`) map to `mobile` at read time. The platform
  is never editable after creation.
- Keys `psk_web_<43>` / `psk_mobile_<43>` / `ssk_<43>` — 32 random bytes,
  unpadded base64url. The class (publishable/secret) is derived from the
  family, so impossible pairings cannot be requested. A prefix is a readable
  hint only; authentication checks the complete stored credential.
- Adapter registry: web → `browser`, `react`; mobile → `react-native` (future
  native adapters register in `MOBILE_RUNTIME_PLATFORMS` without a new prefix
  or source); server → `node`, `manual`.
- Stable failure codes: `obsolete-key-format`, `key-source-mismatch`,
  `incompatible-source`, `unsupported-adapter`, `secret-key-in-client`.
- Compatibility is decided ONCE per batch after key authentication and BEFORE
  quota, validation, or any write (no analytics/identity/session/projection
  rows, no Live broadcasts). Per-item reasons keep positional semantics; the
  mobile gate is now family-based (`mobile-record-requires-mobile-source`).

**Shipped in this pass:**

- Core: policy module + 13 tests; `integration` declaration on
  `PrismClientOptions`/`ErrorReporterOptions` with the local family check
  (`resolveIntegrationDescriptor`); both batch builders send the adapter
  descriptor; registered mobile runtime platforms replace the RN-only context
  check. Core: tsc clean, 216 tests.
- Adapters declare internally: browser (web; React overrides the name),
  react-native (mobile), node (server, incl. error reporter), reactjs (react
  name over web). Suites: browser 67, node 12, react-native 7, reactjs 31.
- apps/api: `generateApiKey(family)` issues the new format (failing-first
  test); SourcesController creates only canonical platforms and derives the
  key class from the family; web-only origin policy now family-based.
  api: tsc clean, 539 passed | 19 skipped.
- analytics-api: middleware derives the family, validates the stored key's
  format/family (409 configuration faults) and keeps 401 non-disclosing for
  unknown/revoked; controllers reject incompatible/missing declarations
  (403/400) before any write and count bounded reasons
  (`utils/compatMetrics.ts`); page-view and mobile gates are family-based.
  Local suite 184 passed | 18 skipped; real-store opt-in suite 201 passed
  | 1 failed — the single failure is the pre-existing Task-15 stale-title
  assertion in `errors.flows.test.ts`, unrelated to this task.
- Web: canonical platform lists/labels, family-aware SDK snippets
  (browser/RN/node with the right packages), masked keys keep the family
  prefix. 142 tests green.
- Tooling: `scripts/regenerate-source-keys.mts` — dry-run by default,
  `--apply`, optional `--normalize-platforms`; never prints key values.

**Verification status:** accept/reject paths are proven by unit and real-store
tests across all four SDKs and both ingestion lanes. Pending: the
operator-driven run with a NEW project and fresh Web/Mobile/Server sources
(seed each family and prove cross-family rejection), packed-package init
tests, and the hosted pass (separately authorized).

**Known gaps / not in this pass:**

- Slice 3's key-authenticated configuration endpoint and offline/cached
  compatibility semantics (local prefix checks + server enforcement cover the
  security boundary; the config endpoint remains the fail-early UX follow-up).
- Documentation breadth (Browser/React/RN/Node quickstarts, troubleshooting)
  and Sources UI polish for family/key-class labeling.
- Slice 5 execution: existing development keys are NOT rotated yet. Old-format
  keys now fail closed (409 `obsolete-key-format`) until the operator runs the
  regeneration command; credential changes need explicit go-ahead.
- `scripts/seed-kiwi-french-toast.mjs` and older fixtures still carry
  pre-29 key assumptions; the verification seed scripts use the new contract.

**Local real-store environment for verification:** isolated sqld on
`127.0.0.1:8082` (temp db path) with the full migration journal; the
`PRISM_RUN_INTEGRATION=1` suite runs against it.

### 2026-09-13 — operator verification, new project `gray-frittata-390733362`

Fresh project with one source per family (`website` / `mobile` / `server`);
all three keys current-format and active. Results:

- **Cross-family rejection proofs (live, against the dev API):**
  mobile key + browser descriptor → 403 `incompatible-source`; mobile key +
  node descriptor → 403; server key + browser descriptor → 403; server key +
  missing descriptor → 400 `unsupported-adapter`; tampered prefix → 401
  `unauthorized`; web key without an allowed origin → 403
  `origin_not_allowed`. No rows written by any probe.
- **Positive seeds:** mobile (RN adapter, salted ingest instance) 238 events
  accepted / 0 rejected; server (node adapter) 265 accepted / 0 rejected;
  web (browser adapter, allowed origin `http://localhost:5173`) 116 accepted
  / 0 rejected. Store: 5 mobile installations, 20 app sessions, 125 screen
  views; 4 server error groups (24 occurrences); 50 web page views across
  4 visitors / 15 sessions (`/` 19, `/docs` 8, `/docs/quickstart` 8,
  `/pricing` 8) with HN/GitHub/Google referrers and 2 identified visitors.
  Platform attribution: mobile 238 · server 241 · web 116 (595 total events).
- **Origin policy, both directions:** `http://evil.example.com` → 403
  `origin_not_allowed`; `http://localhost:5173` (allowed) → 200. Web
  ingestion only works once an allowed origin is configured, as designed.
