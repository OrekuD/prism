# Task 27: Bounded, evidence-backed project investigations

**Status:** Proposed; not implemented or release-ready.  
**Created:** September 11, 2026.  
**Depends on:** [Task 22](task-22.md) readiness for the selected flow, correlation
in [Task 23](task-23.md), releases in [Task 24](task-24.md), definitions in
[Task 25](task-25.md), and analysis tools in [Task 26](task-26.md).  
**Scope:** Implement hosted project investigations, first on demand, then
explicitly enabled background monitoring. This file is the implementation plan.

## Goal and first use case

Make one investigation dependable: **Did this release make signup worse?**
Calculate whether conversion changed, check instrumentation health, and compare
release exposure and affected groups. Return supported observations, plausible
explanations, contradictory evidence, and the information still missing.

An association is not proof of causation. Don't name a commit as the cause just
because it preceded a change. Don't present estimated lost revenue, fabricated
confidence percentages, or a raw event volume change as conversion loss.

## Current baseline and boundaries

Task 21 already supplies canonical metrics, snapshot contexts, structured facts,
artifact validation, private conversations, memory, and a bounded tool loop.
`apps/api/src/utils/projectOverview.ts` already performs deterministic insight
detection. Extend these foundations instead of adding another metric engine or
another chat runtime. Task 21 still has open hosted evaluation and UI proof;
checked implementation boxes aren't production evidence.

Follow the shared implementation and redesign instructions in Task 22. Begin
with a discovery checkpoint before editing product code.

`assistantAuthCache.ts` caches read authorization within a run. It isn't a
durable grant for a scheduled job. `assistantQuotas.ts` explicitly uses
process-local counters; background work across Workers must not rely on these
as shared spending enforcement. Do not silently promote existing overview
thresholds into statistically validated anomaly detection.

Keep predictive churn, customers' AI-run observability, autonomous code changes,
and arbitrary cross-project knowledge graphs outside this task. No graph
database is required: typed references and scoped relational queries suffice.

## Slice 1: Freeze the investigation contract

Define a reproducible case before introducing automation.

- [ ] Inventory the current Task 21 contracts and open findings. Record which
      Task 22–26 acceptance items the signup investigation actually requires;
      keep unavailable mobile or incomplete SDK capabilities gated.
- [ ] Freeze an investigation resource: project, creator/service principal,
      trigger, question, definition versions, current/comparison windows,
      source scope, cutoff, evidence references, status, and revision.
- [ ] Define states for queued, measuring, assessing, complete, inconclusive,
      failed, cancelled, and superseded. Completion need not mean a cause was
      found. Freeze allowed transitions and retry semantics.
- [ ] Store project-visible cases separately from user-private conversations.
      Starting a private chat about a case must not publish that transcript.
      Record visibility explicitly; enforce project membership on every read.
- [ ] Define retained evidence snapshots and deletion policy. Expired signing
      tokens must not turn historical evidence into a silent fresh query:
      retain authorized evidence, or label reproduction unavailable.

## Slice 2: Deterministic assessment pipeline

Compute candidate explanations in code and SQL; the LLM explains the bounded
results. It must not scan raw histories to calculate statistics.

- [ ] Start with telemetry-health checks from Task 26: freshness, completeness,
      known SDK failures, duplicates, and definition compatibility. Missing
      evidence yields inconclusive or instrumentation-suspect, not recovery.
- [ ] Measure the confirmed signup funnel using one snapshot and explicit
      denominators. Preserve currency, platform, release exposure, and source
      distinctions rather than inferring them from SDK family names.
- [ ] Freeze a versioned detection policy with minimum samples, absolute and
      relative effect thresholds, uncertainty, equal exposure windows, and
      weekday/time-of-day handling where supported. Test low-volume silence.
- [ ] Bound dimension searches and correct for repeated subgroup testing. Show
      sample sizes and uncertainty; don't select the loudest small cohort.
- [ ] Evaluate release association, correlated errors, acquisition mix, and
      instrumentation failures using Tasks 23–26. Include disconfirming checks
      and an explicit other/unknown explanation when evidence is insufficient.
- [ ] Represent every claim with fact IDs, exact filters, units, definition
      version, and comparison basis. Reuse canonical dashboard drill-downs.
      Verify a clicked drill-down reproduces the cited values.

## Slice 3: Durable execution and monitoring

Ship on-demand execution first. Add opt-in schedules only after its hosted
accuracy and execution evidence passes.

- [ ] Choose and document a hosted durable queue/scheduler compatible with the
      existing deployment. Define retry count, lease duration, timeout, and
      backpressure limits; don't hold the interactive HTTP request open.
- [ ] Use transactional job claims, expiring leases, fencing, and idempotent
      case writes. A retry or overlapping schedule must not duplicate cases.
      Derive a deduplication key from project, policy, definition, and window.
- [ ] Resolve tenant/project/source scope server-side at execution, never from
      model arguments. Define the authorized service principal for opt-in
      monitors; cancelling or losing its grant must block future execution.
- [ ] Recheck grants at job start and before publishing. Do not reuse stale
      authorization across jobs. Test revocation during a retry and deletion
      while leased. Private chats remain outside background job inputs.
- [ ] Add shared, atomic usage reservations and reconciliation for workspace
      quotas, concurrent jobs, database work, and model spending. Reserve
      before provider calls; make settlement idempotent across crashes.
- [ ] Keep analytics reads sequential where current Workers/libSQL constraints
      require it. Reuse run memoization; freeze measured query/time limits.
- [ ] Add cooldowns, incident grouping, acknowledgement, pause, and last-run
      status. Missing traffic isn't an endless stream of new incidents.

## Slice 4: Optional explanation through the existing agent

The investigation must remain useful when the model is disabled or unavailable.

- [ ] Reuse Task 21's OpenRouter adapter, validated answers, provider privacy
      policy, and artifact channel. Pass compact facts and assessed hypotheses,
      not full event rows, person traits, raw logs, or private chat history.
- [ ] Treat event names, release messages, and other customer text as untrusted
      data. Test prompt injection without relying on prompt wording for auth.
- [ ] Validate numeric and directional prose against canonical evidence. Mark
      interpretations as hypotheses; return deterministic findings on timeout,
      invalid output, exhausted spending limits, or unsupported capabilities.
- [ ] Freeze separate measurement and explanation usage records. Measure the
      cheapest qualifying model; don't enable paid background runs merely
      because offline mocks pass.

## Layout and interaction

Integrate with the redesign in progress; do not rebuild the sidebar or replace
the project overview's existing conversation experience.

- [ ] Inspect current overview, insights, widgets, and detail-sheet components
      before editing. Agree on the case detail route/sheet within the existing
      project context; add a navigation item only through a separate decision.
- [ ] Show up to the existing bounded overview insight count, with severity,
      measured change, period, evidence quality, and last assessed time. A calm
      state must not invent an insight to fill the layout.
- [ ] Detail contains a short conclusion, exact outcome/comparison widget,
      release timeline, affected groups, evidence and counterevidence, gaps,
      and **Ask about this**. That action creates or continues a private chat.
- [ ] Show friendly progress such as **Checking tracking health** and
      **Comparing signup completion**, never raw reasoning or tool payloads.
      Include queued, inconclusive, partial, cancelled, stale, and retry states.
- [ ] Reuse current theme tokens, responsive patterns, accessible charts, and
      focus behavior. Don't overwrite concurrent visual work or freeze old
      screenshots as the new source of truth.

## Verification and handoff

Use focused, failing-first fixtures and real-store concurrency checks, followed
by one hosted release-to-signup investigation. Avoid unrelated cleanup.

- [ ] Prove known regression, no regression, low traffic, late ingestion,
      missing correlation, retired source, and instrumentation-break cases.
- [ ] Prove source/tenant isolation, revoked grants, job deduplication, lease
      takeover, cancellation, shared spending ceilings, and purge behavior.
- [ ] Record zero dashboard/fact/widget mismatches, query counts, cold latency,
      explanation cost, and uncertainty wording. Label unrun checks pending.
- [ ] Document policy versions, false-positive handling, retention, provider
      egress, and operator controls. Read `docs-writer`; use `diagnose` for
      unresolved behavior and relevant design skills only for UI slices.
- [ ] Hand the stable case/evidence contract to [Task 28](task-28.md). Hosted
      proof gates this release; broad self-host support remains separate.
