# Task 28: Approved action handoffs and recovery verification

**Status:** Proposed; not implemented or release-ready.  
**Created:** September 11, 2026.  
**Depends on:** [Task 27](task-27.md) investigation cases, release records in
[Task 24](task-24.md), and relevant readiness gates in [Task 22](task-22.md).  
**Scope:** Implement hosted, user-approved handoffs and outcome recovery checks.
This file is the implementation plan, not authorization for external writes.

## Goal and boundaries

Close the investigation loop: a user reviews evidence, chooses a next action,
records a remediation, and sees whether the error and product outcome improve.
Closing an issue isn't proof of recovery. Removing an exception while signup
completion remains degraded must produce **Outcome not recovered**.

Start with an in-product action record and a copyable issue draft. Add one
explicitly configured issue destination as a bounded integration slice. Do not
build a general automation platform, autonomous coding agent, rollout manager,
or rollback mechanism. Code changes, PR creation, billing updates, user messages,
and flag changes require later contracts and separate authorization.

Follow the shared implementation and redesign instructions in Task 22. Begin
with a discovery checkpoint before editing product code.

## Current baseline and integration constraints

Task 21 already supplies project-scoped evidence, private chats, structured
widgets, and owner/admin confirmation for shared memory. Reuse its security and
rendering patterns, but do not equate memory confirmation with permission to
write into an external system. Read the latest task findings and code before
freezing new endpoints; ongoing assistant and layout work remains authoritative.

Task 27 supplies durable jobs and case visibility. Recovery jobs must reuse that
execution, authorization, deduplication, and spending model. They must not run
from a browser timer or depend on a conversation staying open. An action and
its evidence are project records, not automatically a published chat transcript.

## Slice 1: Action and approval contracts

Separate a suggestion from authorization and delivery.

- [ ] Define action proposal, approved action, delivery attempt, remediation
      record, and recovery assessment resources, each bound to project/case.
      Freeze revisions, timestamps, actors, and evidence references.
- [ ] Define proposed, approved, delivering, delivered, failed, unknown, and
      cancelled states. Keep delivery state separate from recovery state.
- [ ] Freeze a permission matrix: members can draft; owner/admin can connect a
      destination and approve delivery. Recheck membership and destination
      access server-side at approval and execution, bypassing read caches.
- [ ] Bind approval to the exact destination, action type, payload digest,
      evidence revision, and expiry. Editing any of these invalidates approval;
      an agent's suggestion or conversational assent isn't a reusable grant.
- [ ] Scope idempotency keys to action revision and destination. Reject key
      reuse with different content, including after an ambiguous timeout.
- [ ] Define deletion and retention with Task 27. Explain that deleting a Prism
      project doesn't automatically delete an already-created external issue.

## Slice 2: Useful local handoff first

Make the workflow valuable without requiring an external account connection.

- [ ] Generate a deterministic draft containing observed impact, time range,
      affected scope, release references, supporting and conflicting evidence,
      reproduction pointers if available, and unresolved questions.
- [ ] Avoid raw person identifiers, private chat excerpts, secret-bearing URLs,
      tokens, and unbounded stack traces. Preview the exact exportable content.
- [ ] Allow edits and **Copy issue draft** without claiming an issue was
      created. A local status records that a draft exists, not external delivery.
- [ ] Let a user record the chosen remediation release or timestamp, linked
      issue URL, and note. Validate URLs and distinguish user-entered assertions
      from deployment facts supplied by Task 24.
- [ ] Record dismissal and **Not actionable** reasons without modifying the
      original measurement. Later investigation revisions remain separate.

## Slice 3: One approved external destination

Implement this slice only after choosing the initial provider and verifying its
current official API and permission model. Do not infer a configured integration.

- [ ] Record the provider decision and required permissions. Store credentials
      server-side with revocation and rotation support. Bind repositories or
      teams to the project through an explicit admin configuration.
- [ ] Render a full preview and **Create issue** confirmation showing where the
      data goes. A destination change requires new approval.
- [ ] Use a durable outbox and transactional action claim. Retry transient
      failures with bounded backoff. Record provider IDs and correlation keys.
- [ ] Handle uncertain delivery honestly: reconcile using provider-supported
      idempotency or a deterministic marker before retrying. If reconciliation
      is impossible, require human review; never promise exactly-once delivery.
- [ ] Test revoked credentials, lost membership, changed grants, deleted cases,
      timeout-after-acceptance, duplicate callbacks, and replayed approvals.
- [ ] If webhooks are needed, verify signatures, freshness, event IDs, and
      destination mapping. A webhook cannot grant tenant access or imply that
      a deployed fix has recovered the product outcome.
- [ ] Log audit metadata and safe error codes, not credentials or full exported
      payloads. Display partial failures with an explicit retry/reconcile path.

## Slice 4: Recovery measurement

Define success before checking the result. Reuse Tasks 25–27's versioned outcome
definitions, canonical calculations, and statistical policy.

- [ ] Freeze a recovery policy: incident baseline, remediation exposure,
      observation duration, ingestion lag allowance, sample minimums,
      acceptable outcome/error bounds, and expiry with no conclusion.
- [ ] Measure users actually exposed to the remediation when release evidence
      exists. Without exposure data, label the check time-associated; do not
      call a deployment timestamp proof that affected users received the fix.
- [ ] Keep the original incident snapshot immutable. Each post-fix assessment
      gets its own cutoff and context. Compare contexts explicitly rather than
      relabeling an old fact with a new window to satisfy an artifact schema.
- [ ] Recheck tracking health before declaring recovery. Missing events, source
      shutdown, low denominators, sampling changes, and lost error collection
      yield insufficient evidence, never a successful zero-error result.
- [ ] Freeze a repeated-check policy with minimum exposure and consecutive
      qualifying windows or a justified sequential method. Don't repeatedly
      test until a favorable result appears. Preserve OS/source/release scope.
- [ ] Calculate error recovery and outcome recovery separately. Support
      observing, recovered, partially recovered, not recovered, inconclusive,
      cancelled, and superseded by another remediation.
- [ ] Store exact values, denominators, units, uncertainty, definition versions,
      and evidence links. Recommendations remain non-causal when the design
      doesn't establish causation; omit unsupported monetary loss estimates.
- [ ] Let users pause or stop checks. Apply Task 27's shared quotas and job
      authorization; a deleted project cancels outstanding work.

## Layout and interaction

Extend the investigation detail selected in Task 27. Inspect the current design
and shared components first; do not introduce a competing sidebar or settings
structure while the redesign is active.

- [ ] Add a compact **Next action** region with draft preview, destination,
      approval state, delivery feedback, and external link when confirmed.
- [ ] Show **Verify recovery** as an explicit setup action with baseline,
      remediation, outcome, and observation policy visible before scheduling.
- [ ] Render recovery as two related readings: error behavior and product
      outcome. Show waiting-for-data and partial recovery without a misleading
      green overall badge. Keep exact periods and denominators discoverable.
- [ ] Provide an accessible baseline/incident/post-fix comparison and a timeline
      of evidence revisions, approval, delivery, remediation, and assessments.
      Render separate snapshot contexts honestly in labels and drill-downs.
- [ ] Reuse existing widget primitives, focus restoration, reduced motion, and
      theme tokens. Test mobile preview/confirmation and keyboard operation.
      Do not regress the current primary buttons or concurrent layout edits.

## Verification, documentation, and release gate

Use focused integration and UI checks for each slice. No external issue, paid
job, or production webhook is created without explicit test authorization.

- [ ] Prove approval binding, cross-tenant isolation, revoked grants, outbox
      races, ambiguous delivery handling, and idempotent recovery jobs.
- [ ] Prove full recovery, error-only recovery, no recovery, missing traffic,
      delayed ingestion, rollout overlap, and insufficient sample fixtures.
- [ ] Record one hosted investigation-to-remediation-to-assessment flow with
      exact dashboard parity. Keep unrun provider or hosted checks unchecked.
- [ ] Document external egress, retention, approval scope, stop behavior, and
      recovery limitations. Read `docs-writer`; use `diagnose` when needed and
      relevant design skills for UI work. Preserve unfinished parent tasks.
- [ ] Defer coding PRs, automated instrumentation edits, autonomous rollback,
      predictive scoring, and AI-run observability to separately scoped work.
      Broad self-host support is not a gate for this hosted-first task.
