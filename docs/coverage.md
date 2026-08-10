# Coverage policy

Goal: the project-wide 80% statement/line coverage requirement, reached
through enforceable thresholds that grow over time — never by hiding
untested files.

## Current state

| Workspace | Lines | Functions | Branches | Threshold | Status |
| --- | --- | --- | --- | --- | --- |
| prism-api | ~38% | 29% | 67% | 30 / 25 / 55 | enforced |
| prism-analytics-api | ~72% | 82% | 80% | 60 / 60 / 70 | enforced |

`prism-api` is the laggard: its controllers and managers are large, and the
integration suite (see below) is opt-in. Every integration test that lands
raises the enforced floor.

## Commands

```sh
yarn workspace prism-api test:coverage
yarn workspace prism-analytics-api test:coverage
```

Thresholds are set in each workspace's `vitest.config.ts` (`coverage.thresholds`)
and fail the run when not met.

## Exclusions (documented, not hidden)

- `prism-api`: `src/models` + `src/types` (type-only definitions), `src/database`
  (scripts that require live databases), `src/index.ts` (worker bootstrap,
  covered by the E2E smoke script).
- `prism-analytics-api`: `src/database` (setup script requiring live Turso).

## Raising the thresholds

1. Add regression tests for the next uncovered controller path.
2. Add opt-in integration tests (`PRISM_RUN_INTEGRATION=1`) for DB-backed flows.
3. Raise the threshold in `vitest.config.ts` in the same commit that adds the
   coverage — the threshold must never be lowered without a documented reason
   in this file.
