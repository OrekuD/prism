# Docs restructure implementation report

Brief: `research/simplified-docs-structure.md`. Old sidebar: 8 sections,
68 visible leaf pages. New sidebar: 5 groups, 15 visible pages.

Note: the brief's `ecc:product-capability`, `ecc:frontend-a11y`,
`ecc:nextjs-turbopack`, and `ecc:delivery-gate` skills are not installed in
this environment; their intent (honest capability labels, accessible
navigation, Next/Fumadocs correctness, link/build verification) is applied
manually. `docs-writer` + `docs-auditing` are followed.

## Disposition map (every current page)

| Current page | Disposition | Destination |
| --- | --- | --- |
| getting-started/overview | merge | start/quickstart (intro) |
| getting-started/choose-deployment | merge | self-hosting/self-host-prism |
| getting-started/hosted-quickstart | merge | start/quickstart |
| getting-started/self-hosted-quickstart | merge | self-hosting/install-prism |
| getting-started/concepts | merge | start/quickstart (concepts) |
| analytics/overview | merge+split | features pages (summary metrics) |
| analytics/events | merge | features/capturing-events |
| analytics/people | merge | features/identifying-users |
| analytics/sessions-realtime | merge | features/sessions-and-live-activity |
| analytics/metrics | merge+split | capturing-events / page-analytics / sessions |
| analytics/web-analytics | merge+expand | features/page-analytics |
| tracking/overview | delete (folded intro) | — |
| tracking/web/javascript-browser | merge | start/javascript-sdk |
| tracking/web/react | merge | start/react-sdk |
| tracking/events | merge | features/capturing-events |
| tracking/sessions | merge | features/sessions-and-live-activity |
| tracking/identity | merge | features/identifying-users |
| tracking/global-properties | merge | features/capturing-events + identifying-users |
| tracking/consent | merge | configuration/consent-and-privacy |
| tracking/delivery | merge | configuration/delivery-and-diagnostics |
| tracking/runtime-adapters | merge | reference/sdk-api-and-limits |
| management/projects | merge | configuration/projects-sources-and-keys |
| management/api-keys | merge | configuration/projects-sources-and-keys |
| management/teams | merge | configuration/projects-sources-and-keys |
| management/accounts | delete (UI self-evident; brief: no standalone page) | — |
| management/authentication | merge | configuration/projects-sources-and-keys |
| privacy-security/data-collection | merge | configuration/consent-and-privacy |
| privacy-security/consent-identity | merge+split | identifying-users + consent-and-privacy |
| privacy-security/person-data | merge | features/identifying-users (export/delete) |
| privacy-security/retention | merge+split | consent-and-privacy (basics) + configure-and-operate (ops) |
| privacy-security/security-model | internalize | engineering/security-model.md |
| self-hosting/overview | merge | self-hosting/self-host-prism |
| self-hosting/requirements | merge | self-hosting/install-prism |
| self-hosting/architecture | merge+internalize | self-host-prism (topology) + engineering |
| self-hosting/installation | merge | self-hosting/install-prism |
| self-hosting/first-boot | merge | self-hosting/install-prism |
| self-hosting/troubleshooting | merge | self-hosting/configure-and-operate |
| self-hosting/configuration/* (7) | merge | self-hosting/configure-and-operate |
| self-hosting/operations/* (6) | merge | self-hosting/configure-and-operate |
| reference/sdk (index) | merge | reference/sdk-api-and-limits |
| reference/sdk/core | keep (hidden child, updated) | — |
| reference/sdk/browser | keep (hidden child, updated) | — |
| reference/sdk/frameworks/react | keep (hidden child, updated) | — |
| reference/sdk/runtime-adapter | keep (hidden child, updated) | — |
| reference/api/ingestion | internalize + redirect | engineering + delivery page |
| reference/api/management | internalize | engineering/ |
| reference/api/analytics-queries | internalize | engineering/ |
| reference/api/realtime | internalize | engineering/ |
| reference/api/errors | internalize | engineering/ |
| reference/limits | merge | reference/sdk-api-and-limits |
| contributing/* (3) | move | engineering/ (repository docs, not public) |

## Redirect plan (old public URL → new)

- /docs/getting-started/hosted-quickstart, /docs/getting-started/overview,
  /docs/getting-started/concepts → /docs/start/quickstart
- /docs/getting-started/choose-deployment → /docs/self-hosting/self-host-prism
- /docs/getting-started/self-hosted-quickstart → /docs/self-hosting/install-prism
- /docs/analytics/events → /docs/features/capturing-events
- /docs/analytics/web-analytics → /docs/features/page-analytics
- /docs/analytics/metrics → /docs/features/capturing-events
- /docs/analytics/overview → /docs/start/quickstart
- /docs/analytics/people → /docs/features/identifying-users
- /docs/analytics/sessions-realtime → /docs/features/sessions-and-live-activity
- /docs/tracking/events → /docs/features/capturing-events
- /docs/tracking/identity → /docs/features/identifying-users
- /docs/tracking/sessions → /docs/features/sessions-and-live-activity
- /docs/tracking/global-properties → /docs/features/capturing-events
- /docs/tracking/consent → /docs/configuration/consent-and-privacy
- /docs/tracking/delivery → /docs/configuration/delivery-and-diagnostics
- /docs/tracking/runtime-adapters → /docs/reference/sdk-api-and-limits
- /docs/tracking/overview → /docs/start/quickstart
- /docs/tracking/web/javascript-browser → /docs/start/javascript-sdk
- /docs/tracking/web/react → /docs/start/react-sdk
- /docs/management/:path* → /docs/configuration/projects-sources-and-keys
- /docs/privacy-security/data-collection → /docs/configuration/consent-and-privacy
- /docs/privacy-security/consent-identity → /docs/features/identifying-users
- /docs/privacy-security/person-data → /docs/features/identifying-users
- /docs/privacy-security/retention → /docs/configuration/consent-and-privacy
- /docs/privacy-security/security-model → /docs/configuration/consent-and-privacy
- /docs/self-hosting/overview|requirements|architecture → /docs/self-hosting/self-host-prism
- /docs/self-hosting/installation|first-boot → /docs/self-hosting/install-prism
- /docs/self-hosting/configuration/:path*, operations/:path*, troubleshooting → /docs/self-hosting/configure-and-operate
- /docs/reference/limits → /docs/reference/sdk-api-and-limits
- /docs/reference/api/ingestion → /docs/configuration/delivery-and-diagnostics
- /docs/reference/api/realtime → /docs/features/sessions-and-live-activity
- /docs/reference/api/management|analytics-queries|errors → /docs/reference/sdk-api-and-limits
- Legacy /docs/start/*, /docs/hosted/*, /docs/product/*, /docs/sdks/*,
  /docs/api-reference/*, /docs/operations/* chains are re-pointed to the
  new destinations (no redirect chains).

## Destination note

The repository keeps internal engineering documentation in
`engineering/`, which is intentionally gitignored (local-only by
design). Internalized pages live there; the superseded public pages
remain retrievable from git history.

## Result

- Visible pages: 68 → 15 (start 3, features 5, configuration 3,
  self-hosting 3, reference 1). Hidden-but-searchable: 4 SDK symbol pages.
- Internalized: reference/api (5), security-model, contributing (3),
  architecture details.
