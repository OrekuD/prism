# Task 26: Build trustworthy analysis tools and instrumentation health

**Status:** Planned; deliver incrementally by analysis capability  
**Created:** September 11, 2026  
**Depends on:** Relevant [Task 22](task-22.md) readiness,
[Task 23](task-23.md) correlation, [Task 25](task-25.md) definitions;
[Task 24](task-24.md) for deployment/exposure analysis  
**Scope:** Deterministic analysis primitives shared by dashboard and assistant

Give Prism code the ability to test a hypothesis before asking a language
model to explain it. Start with signup funnels, affected-group comparisons,
and measurement-health checks; add retention and reusable cohorts as separate
reviewable slices rather than blocking the first investigation on every tool.

## Current foundation and approach

Reuse `projectMetrics.ts`, Web/Mobile loaders, People reads, and Task 21's
fact/comparison/artifact schemas and tool registry. Existing count comparisons
and threshold-based overview insights are not a general funnel, retention,
statistical anomaly, or attribution engine.

Follow Task 22's shared instructions. Analysis results must include definitions,
scope, snapshot, units, denominators, exclusions, and coverage. The LLM does
not compute rates, fit predictive models, or generate database queries.

## Slice 1: Freeze the analysis resource contracts

Extend the canonical service instead of creating assistant-only calculations.

- [ ] Define typed query/result contracts for funnel, cohort comparison,
  retention, and instrumentation-health checks, versioned independently.
- [ ] Specify entity, source, OS, environment, timezone, interval boundaries,
  bot policy, late-data cutoff, and definition version for each calculation.
- [ ] Freeze bounded series, row counts, pagination, query complexity, and
  execution deadlines. Define explicit partial/unsupported results.
- [ ] Make drill-downs replay the same scope and snapshot; no private tool-only
  filters that the user cannot inspect in the dashboard.
- [ ] Choose indexes/projections from measured query plans and seeded data.
  Don't assume today's sequential loader strategy scales to arbitrary joins.

## Slice 2: Ordered funnels and journey outcomes

Deliver the smallest useful signup funnel first.

- [ ] Evaluate an explicit start and completion definition within an agreed
  conversion window using Task 23 links and Task 25 counting rules.
- [ ] Define strict versus intervening-event ordering, repeated attempts,
  cross-session behavior, and earliest versus repeated conversions.
- [ ] Return step counts, denominators, conversion, elapsed-time distribution,
  and incomplete-observation coverage. A user still inside the conversion
  window isn't automatically a dropout.
- [ ] Support source/platform/OS/release breakdowns only when their attribution
  is defined; record users exposed to multiple versions separately.
- [ ] Support bounded drill-downs to included/excluded journeys with authorized
  access. Never dump entire event histories to the model.

## Slice 3: Affected versus unaffected comparisons

Measure associations without promoting them to causal effects.

- [ ] Compare error-exposed journeys against a defined comparison population.
  Exposure must occur before the measured outcome and within the defined window.
- [ ] Separate observed conversion differences from estimated causal impact.
  Report sample sizes, baseline selection, missing links, and confounders.
- [ ] Add release/source/OS segmentation and guards against sparse cells,
  overlapping groups, repeated-person double counting, and selection bias.
- [ ] Implement an agreed statistical method with reproducible uncertainty
  estimates and multiple-comparison protection when scanning dimensions.
- [ ] Return insufficient-evidence when requirements fail. Do not emit precise
  churn probability or lost MRR from an observed conversion difference.

## Slice 4: Instrumentation health

Check whether the measurement changed before concluding the product changed.

- [ ] Build per-source/event/schema health summaries: accepted and rejected
  volume, last receipt, lag, duplicate delivery, property presence/type drift,
  SDK versions, and observed collection gaps.
- [ ] Keep expected retry deduplication separate from accidental duplicate
  semantic events, which transport IDs alone cannot identify reliably.
- [ ] Allow approved expected-event/schema contracts. Absence alone cannot
  distinguish idle traffic, consent, offline devices, or broken instrumentation.
- [ ] Detect abrupt event disappearance, step-order violations, and new property
  failures relative to source traffic and deployment history where available.
- [ ] Reconcile independent server/provider signals only when an integration
  exists. Never claim a billing webhook is healthy without reading its data.
- [ ] Aggregate operational rejection signals without persisting rejected raw
  payloads or secrets just to support health dashboards.
- [ ] Define alert eligibility by history, volume, and seasonality. Start with
  explicit rules; statistical detection must state its assumptions.

## Slice 5: Retention and reusable cohorts

These extend the same measurement layer after the first signup investigation
works; their absence must remain explicit in assistant capabilities.

- [ ] Define cohort entry and return actions, calendar versus rolling periods,
  user timezone policy, and identity merging semantics.
- [ ] Exclude immature cohorts from completed-period retention comparisons;
  preserve censoring and coverage in results.
- [ ] Implement versioned saved cohort definitions and snapshot membership,
  bounded previews, deletion, and project-scoped access.
- [ ] Support behavioral comparisons without naming unsupported personas or
  treating model-generated demographic labels as measured facts.

## Layout

Reuse current data-page designs and keep navigation coordinated with the
ongoing redesign. These are destinations, not permission to expose placeholders.

- Add **Funnels**, **Retention**, and **Cohorts** to the established analysis
  navigation only as each corresponding capability becomes usable.
- Funnel detail shows definitions, steps, conversion window, breakdowns,
  coverage, and an **Investigate change** entry point.
- Put **Instrumentation health** in the existing Sources experience, with a
  project summary and source/event drill-downs rather than another top-level app.
- Assistant artifacts render exact computed funnel/comparison/health results.
  Keep concise summaries, expandable measurement details, and visible uncertainty.
- Provide table alternatives, keyboard-accessible filters, and useful loading,
  low-volume, unavailable, error, and no-data states in both themes.

## Verification and acceptance

Use an isolated deterministic dataset with independently specified expected
answers, then verify through the real ingestion and canonical read path.

- [ ] Cover repeated attempts, identity linking, late events, incomplete windows,
  consent gaps, source mixing, multi-release exposure, and bot filtering.
- [ ] Reproduce one real product drop and one broken-instrumentation drop;
  their health/analysis results must be distinguishable.
- [ ] Assert exact parity between API, widgets, tool facts, and drill-downs.
- [ ] Measure cold/warm query cost in the target runtime and reject queries
  exceeding agreed bounds with actionable errors, not silent truncation.
- [ ] Document statistical assumptions and unsupported questions.
- [ ] Hand Task 27 a verified signup funnel, comparison tool, and measurement
  health tool without claiming every later retention/cohort feature is complete.
