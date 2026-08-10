# Dependency security inventory

Status after the Task 2 dependency pass (2026-08). Generated from
`yarn audit --groups dependencies`.

## Summary

| Metric | Task 1 baseline | Now |
| --- | --- | --- |
| Total advisories | 314 | 52 |
| Critical | 2 | 0 |
| High | 122 | 3 |
| Moderate | 163 | 40 |
| Low | 27 | 5 |

Every high-severity finding that touches a **production runtime** has been
fixed. The three remaining highs are all the same package in the same
build-time-only workspace.

## Production-runtime findings (all fixed)

| Package | Workspace | Fix |
| --- | --- | --- |
| `ws` < 8.21.0 | prism-analytics-api (`@hono/node-ws`) | resolution `ws@8.21.3` |
| `lodash` < 4.18.0 | prism-web (via `recharts`) | resolution `lodash@4.18.1` |
| `axios` | prism-web | upgraded to 1.19 |
| `@remix-run/router` | prism-web (react-router) | upgraded react-router-dom to 6.30 |
| `drizzle-orm` | prism-api | upgraded to 0.45 |
| `@hono/node-server` | prism-analytics-api | upgraded to 1.19 |
| `jsonwebtoken` (`jws`) | prism-analytics-api | upgraded to 9.0.3 |
| `form-data`, `js-cookie`, `minimatch`, `glob`, `cross-spawn` | transitive | patched via resolutions |

## Remaining high findings (documented)

### `astro` < 5.15.8 / < 6.3.3 / < 6.4.6 — prism-docs (3 advisories)

- **Reachability**: build-time only. `astro build` runs locally and in CI to
  produce a static site; the generated output is plain HTML/JS with no
  server-side execution. The vulnerable behavior is not reachable from
  deployed code and the docs content is first-party and trusted.
- **Why not upgraded now**: astro 4.16 is the last release of the 4.x line;
  the fixes require astro 5/6, which is a major migration (config API
  changes) and also requires a matching Starlight major. The docs content is
  still the starter pages and will be rewritten in Task 13; the astro 6
  migration is bundled with that work.
- **Owner**: @OrekuD — **Follow-up**: Task 13 (docs rewrite + astro 6).
- **Compensating controls**: docs are not deployed to a runtime; no untrusted
  input reaches the build; the dependency-review CI job (below) will flag
  this again if it is not resolved by then.

## Resolutions in effect (root `package.json`)

Pinned for security, all within the semver range declared by their
dependents: `brace-expansion 2.1.4`, `cross-spawn 7.0.6`, `dset 3.1.4`,
`glob 10.5.0`, `js-cookie 3.0.8`, `js-yaml 3.15.1`, `lodash 4.18.1`,
`minimatch 9.0.9`, `nanoid 3.3.18`, `postcss 8.5.26`, `sharp 0.35.3`,
`socket.io-parser 4.2.7`, `ws 8.21.3`, `zod 3.25.76`.

## CI policy

`.github/workflows/security.yml` runs `yarn audit` weekly and on lockfile
changes. `scripts/audit-check.mjs` fails the build only when a high/critical
advisory is reachable from a production workspace and is not explicitly
allowlisted. Allowed entries must name an owner and a follow-up task.
