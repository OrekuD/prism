# Task 22: Establish the trusted hosted-platform baseline

**Status:** Planned; discovery required before implementation  
**Created:** September 11, 2026  
**Scope:** Reconcile and prove existing capabilities, not rebuild them  
**Depends on:** The applicable remaining work in Tasks 14–21

This task establishes the evidence required to build trusted investigations
on Prism. Existing implementation, historical review findings, and hosted
readiness are different things. Do not infer completion from a task heading,
a checked box, or passing mocked tests.

## Roadmap and ownership

These seven tasks implement the agreed progression. This file also contains
the shared implementation instructions for Tasks 23–28.

| Task | Responsibility | Dependency |
| --- | --- | --- |
| [22](task-22.md) | Existing-platform readiness and evidence | Applicable Tasks 14–21 |
| [23](task-23.md) | Telemetry correlation and journeys | Relevant Task 22 contracts |
| [24](task-24.md) | Releases and change history | Source/auth baseline; Task 23 correlation contracts |
| [25](task-25.md) | Versioned product definitions | Standard Events and Task 21 memory |
| [26](task-26.md) | Analysis primitives and instrumentation health | Tasks 23 and 25; Task 24 for change attribution |
| [27](task-27.md) | Bounded investigations | Relevant Tasks 23–26 capabilities |
| [28](task-28.md) | Approved actions and recovery verification | Tasks 24 and 27 |

Work can proceed on independent contracts in parallel. Readiness is scoped
to a capability: unfinished native crash collection must not block a proven
web signup investigation. It must block claims about native crash impact.

Existing tasks retain ownership of their unfinished fixes. Link their exact
open item from this task's implementation log. Do not create two competing
implementations or mark the original task complete without its own evidence.

## Current evidence and starting points

The repository contains more functionality than the older handoff describes.
Inspect the current branch before relying on any of these observations.

- SDKs: `packages/core`, `browser`, `reactjs`, `react-native`, and `node`.
- Analytics ingestion: `apps/analytics-api/src/controllers/IngestController.ts`.
- Error ingestion: `ErrorIngestController.ts` and `ErrorIngestRepository.ts`.
- Canonical facts and overview: `apps/api/src/utils/projectMetrics.ts` and
  `projectOverview.ts`; reuse their calculation and snapshot contracts.
- Assistant: `assistantTools.ts`, `toolLoopAgent.ts`, and Task 21 storage,
  controllers, streaming, and widget components.
- Mobile visitor/installation facts currently have an explicit unavailable
  gate in `projectMetrics.ts` referencing Task 18 R4-F3. Reconcile the owning
  fix before removing that gate; don't simply restore numeric responses.
- Task 21 records outstanding hosted evaluations and runtime/visual proof.
  Its old review checkboxes aren't an authoritative current bug inventory.
- `engineering/project-handoff.md` contains historical state. Current code,
  migrations, and later task evidence take precedence.

## Shared implementation instructions

Apply these rules to every task in this set.

- [ ] Read the current design specification and the relevant existing task's
  latest findings. Inventory code, tests, and migrations before editing.
- [ ] Record each capability as verified, implemented but unverified, blocked,
  or absent, with file references and a concrete next step.
- [ ] Preserve concurrent redesign work. Agree file ownership before editing
  shared layouts; don't revert designs, move workspace controls, or invent a
  second sidebar. Contract work can proceed independently of UI polishing.
- [ ] Use the available docs-writer skill for documentation; use api-design
  for changed endpoints, database-migrations for schema changes, and diagnose
  for reproduced defects. For UI work, read the applicable design, motion,
  and accessibility skills and the project's current design specification.
- [ ] Use server-authenticated workspace/project/source scope. Model output,
  correlation IDs, and browser filters never grant access.
- [ ] Keep calculations in canonical code. Tools return bounded facts,
  provenance, coverage, and typed artifacts, not unrestricted raw telemetry.
- [ ] Keep consent, redaction, tenant isolation, deletion, and retention valid
  across primary rows, derived data, caches, jobs, and assistant artifacts.
- [ ] Use bounded migrations and tests on isolated data. Do not assume that
  being prelaunch authorizes deleting current hosted data or evidence.
- [ ] Write a failing regression before each fix. Run focused tests first;
  reserve broader integration/release checks for the relevant delivery gate.
- [ ] Record commands, environment, commit, and actual results. Local, mocked,
  real-store, and hosted results must be labeled separately. Never copy old
  completion claims into a new progress entry.
- [ ] Get explicit approval for deploys, publishing, paid model runs, outbound
  integrations, and external writes. This roadmap isn't that approval.

## Slice 1: Reconcile the remaining work

Build a small evidence matrix in this task's progress section, not another
parallel project plan.

- [ ] Reconcile Tasks 14–21 by current code and their latest review notes.
- [ ] Include auth/workspace handoff, source setup/key behavior, Core queue
  delivery, Browser/React collection, Node actors, and React Native lifecycle.
- [ ] Include Events, People, Web/Mobile analytics, Errors, and Live. Distinguish
  JS errors from native crashes and observed installations from store installs.
- [ ] Include assistant answers, citations, comparisons, memory, conversation
  recovery, cancellation, and current OpenRouter configuration behavior.
- [ ] Assign each blocker to its existing owner and required reproduction.

## Slice 2: Prove telemetry truth

Use controlled fixtures with known expected records through the real SDK and
ingestion boundary, rather than seeding only the final read tables.

- [ ] Test anonymous activity → identify → Standard Event → custom event →
  error → reset → second user, with expected identity and source attribution.
- [ ] Exercise retries, duplicate delivery, out-of-order receipt, consent
  withdrawal, offline recovery, archived sources, and revoked keys.
- [ ] Verify consistent time windows, time zones, bot filters, source filters,
  late-arrival cutoffs, unknown dimensions, and comparison denominators.
- [ ] Compare stored rows, dashboard resources, tool facts, and rendered
  widgets. Confirm unavailable values never become successful zeroes.
- [ ] Prove Live reconnect and expiry semantics separately from durable
  historical counts. A live socket preview isn't a history database.
- [ ] Keep failing capabilities unavailable or explicitly partial until fixed.

## Slice 3: Hosted proof and operational readiness

Extend Task 14 and Task 21 evidence rather than invent another certification
claim. The first release target is hosted Prism, not self-host certification.

- [ ] Run the approved external React integration against the hosted stack.
- [ ] Run supported Node and React Native scenarios when those capabilities
  are included in the release; otherwise document the narrower supported set.
- [ ] Verify signin without reload, workspace/project switching, source setup,
  fresh and cached reads, chat switching, and error recovery.
- [ ] Measure cold/warm overview and assistant response stages in the deployed
  runtime; record query counts, time to feedback, and time to grounded answer.
- [ ] Run canonical-answer and adversarial assistant evaluations with approved
  model spending. Do not equate structural schema tests with answer accuracy.
- [ ] Agree release thresholds before measuring. Record observed failures and
  owners rather than lowering the thresholds after the run.

## Layout and redesign coordination

This task does not introduce a new page. Preserve current page composition.
Only fix correctness, loading/error states, or accessibility defects required
by the tested journey. Show names loading without hiding navigation structure;
show unknown coverage without fake metrics. Defer visual captures until the
relevant redesign slice settles, but keep them explicit release requirements.

## Acceptance and next steps

Completion means the selected hosted capability set is demonstrably usable.

- [ ] Publish the capability/evidence matrix and remaining exclusions here.
- [ ] Resolve or explicitly exclude every blocker for the first investigation.
- [ ] Confirm dependent Tasks 23–28 reference the verified contracts.
- [ ] Update stale project handoff statements only after verification.

The initial vertical target is “Did this release make signup worse?” Broader
customer-agent observability, predictive churn, replay, native SDKs, and
autonomous remediation remain separate future scope, not hidden requirements
for completing these seven tasks.

## Progress log

### 2026-09-11 — Slice 1 reconciliation (first pass)

**Environment:** `redesign/web-ui` @ `b650dc5`, clean tree. This entry adds
documentation only; no code changed. **Method:** full reads of
`task-14.md`…`task-21.md`; code/test/migration inventory; targeted greps
against every load-bearing claim below. Web suite re-run this session
(`npx vitest run src/__tests__`) → 140 passed. All other suite counts are
quoted from task logs, not re-run here, and are labeled self-reported. No
hosted or paid runs were performed; those need explicit approval
(task-22.md:84-85).

**Status key:** **V** verified this pass · **I** implemented, local or
self-reported evidence only · **B** blocked (defect or missing contract) ·
**A** absent/excluded.

#### Evidence matrix

| Area | Owner | Status | Evidence | Blocker → required reproduction |
| --- | --- | --- | --- | --- |
| Auth & workspace handoff | 3/13 | I | `workspace-auth-handoff` / `session-handoff` / `auth-flows` web tests; server-side provisioning commit `076d74f`; local web suite green | Hosted sign-in without reload, workspace/project switching, invite accept → Slice 3 run |
| Source setup & key behavior | 13/16 | B | Create/list flows and tests exist; `SourcesController.revealKey` (`apps/api/src/controllers/SourcesController.ts:503`) still returns plaintext; analytics migrations end at 013 — no archive/key-digest migration | Task 16 slice 2: archive transaction + key digest, remove reveal; real-store test proving archive revokes the key and retains attribution |
| Core queue delivery | 9/19 | I | Client queue `packages/core/src/queue.ts` + retry/flush in `core.ts`; server has no delivery queue by design (idempotent batch persist, retryable 503, rate limiter) | Slice 2 fixture through the real SDK + ingestion boundary: duplicate, out-of-order, offline recovery |
| Browser/React collection | 14/17/19 | I | `packages/browser/src/page-tracker.ts`; `packages/reactjs` hooks + error boundary; `fixtures/task-17-web`; task-17 counts self-reported | Packed-tarball consumer proof (deferred at `task-17.md:1132-1133`); hosted page proof |
| Node actors | 15/19 | I | `packages/node` (`createNodeClient`, error reporter; 2 test files) | Include with an external run, or document the narrower supported release set (Slice 3) |
| React Native lifecycle | 18 | B | Round-4 review decision "Do not merge" (`task-18.md:1859`); R4-F1…F7 open; the cited `GATES.md` ledger is absent from the repo | Task 18: fix each round-4 finding failing-first, re-run focused suites; hosted device proof later |
| Events exploration | 16/19 | B | Canonical list + cursor exist; no `GET /events/:eventId` route; web detail is cache-only; Task 16 shows 86 unchecked boxes while slice-1 contracts already exist | Task 16 slice 5: authorized detail endpoint with cross-project 404 tests; reconcile the stale ledger |
| People | 20 | I | `peopleStore` / `people` / `people.test.tsx` suites; R1/R2 closed and round-3 clean (self-reported) | Hosted anonymous→identify→reset→export→delete run; both-theme captures (slice 6 closure) |
| Web analytics | 17 | I | Dashboard route + migration `012_web_page_views`; core/browser counts self-reported; slice 6/8 boxes checked with no log evidence | Hosted read-back proof + packed SDK install; reconcile the "Complete" status (`task-17.md:1132-1133`) |
| Mobile analytics | 18 | B | R4-F3 read-model contract wrong; `projectMetrics.ts:1357-1373` and `projectOverview.ts` return explicit unavailable facts | Task 18 R4-F3; keep the unavailable gate until migrated tests pass, then re-verify assistant/tool facts |
| Errors (JS) | 15 | I | Ingest/grouping/detail + migrations 009–011 exist; local suites self-reported; source maps (Phase 4) and occurrence person/session links absent | Deployed controlled-error e2e (Slice 3); packed consumer ingest proof; keep symbolication claims unavailable |
| Native crashes | — | A | No native crash collection exists | Excluded from the first investigation; never claim native crash impact |
| Observed installations vs store installs | 18 | B | Task 18's definition is observation-only, but R4-F2/F3 inflate and reset counts | Keep the distinction in copy; revisit after the Task 18 fix — never claim store installs |
| Live | 17 | I | `analytics-api` WebSocket manager + web session store; `deletion-invalidates` integration test is opt-in and has no recorded result | Hosted reconnect/expiry proof (Slice 3); a socket preview is never history |
| Assistant answers/citations/comparisons | 21 | I | Tools/answer/store implemented; api suite self-reported; R17 closed | Live zero-mismatch eval + hosted real-telemetry flow (Slice 3; paid model runs need approval) |
| Assistant memory/recovery/cancellation | 21 | I | Local suites; reconnect converges on idempotency-conflict; stop/disconnect abort | Reviewer sign-off on the `useChat` deviation (`task-21.md:5469`); live memory/multi-chat evals |
| Assistant model / OpenRouter config | 21 | B | Allowlist flag `evaluated: true` vs eval file `"recommendation": null`; ZDR-relaxed local run only (`evals/model-eval-gpt-5.6-luna-pro-v1.json:13,21-22`) | ZDR-enforced confirmation run, then re-review the flag (R17-F7) |
| Standard Events | 19 | I | Real-store flows 5/5 + migration 13/13 self-reported (`task-19.md:1072`); hosted slice 7 unchecked; packed proofs unchecked; status line stale | Hosted capture + packed tarball proofs; align status and checklist |
| Hosted journey (Task 14) | 14 | B | `sourceKey` rename + consumer smoke verified in-repo; §7/§8 hosted checks explicitly deferred (`task-14.md:456-463`) | Slice 3 hosted pass (deploy approval required); record origins, commits, commands, actual results |
| Migrations / data baseline | 16/18/21 | I | api `0010_whole_warbird` (2026-09-09); analytics `013_mobile_screen_views`; no deployed-schema verification recorded (Task 14 §1) | Verify the deployed schema; Task 16 slice 2 adds the archive/digest migration |

#### Ledger conflicts found (do not treat as completion)

- `task-17.md` — status "Complete" with slice 6/8 boxes checked, while its own
  log defers the dashboard, hosted proof, packed fixture, and setup UI.
- `task-18.md` — the false slices 9-10 entry is retained with a SUPERSEDED
  marker; the repeatedly cited `GATES.md` is absent; "all gates met" claims sit
  beside round-4's finding that the gates certify behavior they do not test.
- `task-19.md` — status "Ready for implementation" while the log reports slices
  1-6 with real-store evidence; every checklist box is still unchecked.
- `task-15.md` — the "remains uncommitted" note was never revoked; an earlier
  test count was superseded by later entries.
- `task-16.md` — 86 unchecked boxes while slice-1 contracts and part of slice 5
  already exist; slice 2 is provably absent.
- `task-20.md` — checkboxes stale; hosted proof and design-width captures are
  stated outstanding.

No owner task is marked complete by this pass; each retains its items.

#### First-investigation scoping

Target (task-22.md:152): **"Did this release make signup worse?"**
Required: auth/workspace handoff, Browser/React collection, Standard Events,
Events, People, Web analytics, JS errors, Live semantics, assistant comparison
facts. Excluded until fixed or separately approved: native crashes, Mobile
analytics numbers and installation claims, store-install claims, source maps,
Node/RN release scenarios (document the narrower set), paid live evaluations.

#### Next steps

1. Slice 2: define the controlled fixture journey (anonymous → identify →
   Standard Event → custom event → error → reset → second user) through the
   real SDK and ingestion boundary, including retry, duplicate, out-of-order,
   consent withdrawal, and offline cases.
2. Agree release thresholds before any hosted measurement; then run Slice 3
   with deploy approval and record raw outputs here.
3. Close the two decision items: the ZDR-enforced model run and the `useChat`
   deviation sign-off.
