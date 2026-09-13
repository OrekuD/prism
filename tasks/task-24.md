# Task 24: Make releases and changes first-class evidence

**Status:** Planned  
**Created:** September 11, 2026  
**Depends on:** [Task 22](task-22.md) source/auth readiness and relevant
[Task 23](task-23.md) correlation contracts  
**Scope:** Deployments and explicit change records, not CI/CD orchestration

Record what changed, where, and when so Prism can compare product behavior
around deployments without mistaking a release string for a deployment log.

## Current foundation

Events/mobile context and error occurrences already contain some release or
app-version fields. Task 21 can filter by releases and produce release-related
artifacts. Those fields are not deployment timestamps, commit mappings, rollout
exposure, or proof that a release caused a regression.

Inspect `projectOverview.ts`, `projectMetrics.ts`, source schemas, error
occurrence storage, and the SDK context contract. Follow Task 22's shared
instructions and preserve existing full-length release identifiers.

## Slice 1: Define release and deployment resources

Separate software identity from its deployment or exposure.

- [ ] Define a release with project scope, source association, immutable
  version/build identity, optional repository/commit metadata, and provenance.
- [ ] Define deployments separately: source/environment, release, start/end,
  outcome, and external deduplication ID. A release can deploy more than once.
- [ ] Support overlapping web/mobile/server versions and gradual mobile rollout.
  Installation or observed release traffic is not proof of store rollout time.
- [ ] Distinguish observed version, reported deployment, and verified integration
  metadata. Render missing commit/deploy context honestly.
- [ ] Define change records for explicit configuration changes. Flag exposures,
  experiments, and provider-specific change imports are future extensions.
- [ ] Freeze exact identifier bounds, URL validation, timestamp policy, and
  corrections/versioning. Never change a prior snapshot without provenance.

## Slice 2: Authorized ingestion and storage

Provide a small API that CI can call without gaining analytics read access.

- [ ] Design project-scoped deployment-write credentials or permissions; don't
  silently allow publishable SDK keys to create trusted deployment records.
- [ ] Add a minimal CI/CLI or server helper after inspecting the existing Node
  package. Keep this separate from ordinary end-user product events.
- [ ] Enforce idempotency, replay protection where applicable, input bounds,
  tenant scope, and structured retryable/non-retryable errors.
- [ ] Store only permitted repository metadata, not access tokens or source
  code. Validate any external links before rendering or requesting them.
- [ ] Model retention, deletion, source retirement, and corrections. Preserve
  historical references when a source key rotates or a release is superseded.
- [ ] Keep manual records explicitly labeled; don't fabricate a verified commit.

## Slice 3: Link changes to telemetry

Reuse correlation and canonical measurement rather than implement release-only
versions of analytics formulas.

- [ ] Match telemetry using scoped release/build identifiers, not substring or
  truncated display labels. Record unresolved and conflicting mappings.
- [ ] Build an observed release-traffic distribution with source, environment,
  OS, and receipt cutoff. Preserve late-arriving mobile traffic.
- [ ] Define pre/post comparison windows, timezone, minimum exposure, and
  comparison groups. Simultaneous changes must remain visible confounders.
- [ ] Register release/deployment evidence for existing metric tools. Do not
  convert “first observed” into “deployed at.”
- [ ] Distinguish “after deployment” from “among users exposed to this version.”
  Make exposure coverage explicit before enabling impact conclusions.

## Layout

Treat the following locations as integration intent, subject to the active
redesign's route/component conventions.

- Add a project **Releases** destination within the existing diagnostic area
  when its APIs are usable; don't add a new top-level workspace section.
- List version, source/environment, deployment status/time, observation coverage,
  and linked changes. Separate observed-only releases from reported deployments.
- Release detail contains deployment timeline, exposed traffic, linked issues,
  canonical outcome comparisons, and an **Investigate change** action.
- Reuse release links in Errors, Events, and overview artifacts. Long release
  identifiers must remain inspectable and filters must retain their full value.
- Missing setup gets CI instructions; missing metadata gets an unknown state,
  not a green success indicator. Optional repository integration remains optional.

## Slice 4: Tests, docs, and acceptance

Prove the data model before building automated investigations over it.

- [ ] Test redeployments, overlapping versions, rollbacks, partial rollout,
  duplicate CI requests, unknown releases, and cross-project identifiers.
- [ ] Test late mobile receipt and snapshot replay before/after a deployment
  correction. No silent changes to a saved investigation's evidence.
- [ ] Test revoked deployment credentials and rejected publishable keys.
- [ ] Verify canonical release filters agree with list/detail/widget drill-downs.
- [ ] Document a real CI example, credential purpose, source/environment mapping,
  and the limitations of attributing changes from timestamps alone.
- [ ] Capture the approved hosted deployment→telemetry→release-detail flow.

## Handoff

Tasks 26–28 consume release identity, deployment history, and exposure coverage.
External repository reads and issue/PR writes require separate authorization;
this task does not authorize them or automatic rollbacks.
