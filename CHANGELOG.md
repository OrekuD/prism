# Changelog

All notable changes to the `@prism-analytics/*` SDK surface will be documented here. The 5 publishable packages are version-locked: `@prism-analytics/browser`, `@prism-analytics/core`, `@prism-analytics/node`, `@prism-analytics/react`, `@prism-analytics/react-native`.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-08-27

- `@prism-analytics/react`: added `useOptionalPrism` and `<PrismAnalytics />`, fixed `usePrismPageView`, added package metadata.
- `@prism-analytics/browser`: normalized `endpoint` to strip trailing `/api/v2/ingest`, added package metadata.


## [0.0.3] - 2026-08-26

- Fixed published artifacts: builds now wipe dist/ first, so no stale files from earlier API generations ship in the tarball (`@prism-analytics/react` 0.0.2 contained dead `use-prism.js`/`prism-provider.js` from a pre-1.0 layout).

## [0.0.2] - 2026-08-25

- Documentation improvements across all SDK packages: added READMEs, corrected package descriptions, fixed documentation links.

## [0.0.1] - 2026-08-25

- Initial public release across all SDK packages.
