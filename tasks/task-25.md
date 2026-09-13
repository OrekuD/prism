# Task 25: Define versioned product outcomes and business concepts

**Status:** Planned  
**Created:** September 11, 2026  
**Depends on:** [Task 22](task-22.md), Task 19 Standard Events, and Task 21 memory  
**Scope:** Executable, approved definitions shared by UI and tools

Make “signup,” “activation,” and “paying customer” resolve to inspectable
definitions rather than guesses. Extend existing typed project/workspace
memory; do not build a second memory or identity system.

## Current foundation and missing semantics

`packages/core/src/standard-events.ts` defines the Standard Event catalog.
Task 21 provides scoped definition proposals, confirmation, audit, and memory
storage in `assistantStore.ts` and `database/schema/assistant.ts`.

An event label is not a full metric definition. Signup attempts versus unique
people, activation windows, subscription cancellation versus expiration, and
paid entitlement require explicit rules. Subscription events alone don't
establish current billing truth or authorize estimated lost revenue.

Follow Task 22's shared implementation instructions. Preserve current confirmed
memory and business-term normalization invariants through compatible changes.

## Slice 1: Freeze the definition model

Define supported concepts narrowly enough for code to evaluate them.

- [ ] Inventory existing memory keys and executable versus descriptive values.
- [ ] Define immutable definition versions with scope, display name, unit,
  counting entity, event selection, filters, time window, and effective date.
- [ ] Separate descriptive business-term notes from executable metric recipes.
  Free-text notes and model-generated SQL cannot become executable filters.
- [ ] Define signup completion, signup attempt, onboarding completion, and a
  configurable activation outcome. Reuse Standard Event keys where available.
- [ ] Decide and document whether signup-start requires a new Standard Event or
  a confirmed mapping to an existing custom event. Don't silently extend Task 19.
- [ ] Define counting rules for repeat attempts, aliases, anonymous users,
  multiple sources, bots, and late arrivals. Never equate events with people.
- [ ] Keep future customer-account/group entities distinct from Prism's own
  workspace tenancy; a customer's team isn't the Prism organization.
- [ ] Freeze definition references in facts/snapshots so old answers keep their
  original meaning after a definition changes.

## Slice 2: Proposal, approval, and precedence

Use the existing scoped memory permissions and audit path.

- [ ] Let the assistant propose candidate definitions with observed event names,
  a bounded preview, assumptions, and missing evidence. No silent activation.
- [ ] Require authorized confirmation for shared project/workspace definitions.
  Keep private chat text separate from shared knowledge.
- [ ] Define workspace defaults, project overrides, and version precedence;
  member presentation preferences must not change shared measurement meaning.
- [ ] Make concurrent edits, supersession, rejection, and retries idempotent.
- [ ] Invalidate relevant caches by definition version, not broad time-based
  expiration alone. Existing investigations keep their frozen references.
- [ ] Reject recursive definitions, unsupported operations, invalid source
  references, and definitions that span unauthorized projects.

## Slice 3: Canonical evaluation and coverage

Register definitions with the existing metric service and artifact contracts.

- [ ] Implement a bounded typed recipe interpreter/query builder. Reuse existing
  sanitization, authorization, time-window, and snapshot code.
- [ ] Return value, exact comparison basis, definition/version, filters, and
  coverage in the same resource consumed by dashboard and assistant.
- [ ] Return unavailable for missing prerequisites instead of guessing from a
  similarly named event or silently dropping a required step.
- [ ] Add a preview showing how changing the definition changes the result,
  using the same cutoff and data scope for both versions.
- [ ] Treat revenue as a later verified integration contract: currency, refunds,
  billing periods, entitlement changes, reconciliation, and source of truth
  must be settled before MRR or revenue-impact metrics become supported.

## Layout

Keep management inside existing project configuration surfaces.

- Add **Definitions** within project settings, not another sidebar category.
  Show concept, scope, status, active version, and coverage.
- Detail/edit shows plain-language rules beside an exact structured preview,
  approval history, and affected metrics/monitors.
- Chat proposals render reviewable definition cards with confirm/reject for
  authorized roles; other members can inspect or propose, not approve.
- Widgets expose **How this is measured** with the frozen definition version.
- Coordinate with current settings redesign. Reuse current sheets, forms,
  accessible controls, and responsive behavior; don't rebuild settings layout.

## Verification and acceptance

Test business meaning, not just the shape of the proposal.

- [ ] Prove a signup question resolves to the same count through UI and tool.
- [ ] Prove events-versus-people and repeat attempts produce intentional results.
- [ ] Prove a changed definition does not rewrite old answer meaning.
- [ ] Test concurrent confirmations, workspace defaults, project overrides,
  malicious notes/event names, inaccessible sources, and revoked membership.
- [ ] Test unsupported billing/retention definitions return honest explanations.
- [ ] Document mapping existing custom events, approval, versioning, and what
  the assistant can and cannot infer automatically.

## Handoff

Task 26 implements analysis over these definitions. Task 27 freezes their
versions into investigations; Task 28 reuses them when verifying recovery.
