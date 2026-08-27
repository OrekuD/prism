# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.4] - 2026-08-27

- Added `useOptionalPrism()`: non-throwing hook variant returning `PrismReactFacade | null` for trees that may render without a provider (avoids wrapping hooks in try/catch).
- Added `<PrismAnalytics />` drop-in component: reads `VITE_PRISM_SOURCE_KEY`/`VITE_PRISM_ENDPOINT` (and `NEXT_PUBLIC_` equivalents), creates the client with `useState`+`useEffect` (no top-level await), provides context, and mounts page-view tracking automatically.
- Fixed `usePrismPageView`: removed dead `pathRef`/`void pathRef.current`, documented 500ms hostname+path dedupe window in the feature docs.
- Added package metadata (`homepage`, `repository`, `bugs`) for npm discoverability.
- Updated React SDK docs with a recommended `<PrismAnalytics />` section and changed the default example to `pageViews: { mode: "history" }`.


## [0.0.3] - 2026-08-26

- Fixed published artifacts: builds now wipe dist/ first, so no stale files from earlier API generations ship in the tarball (`@prism-analytics/react` 0.0.2 contained dead `use-prism.js`/`prism-provider.js` from a pre-1.0 layout).

## [0.0.2] - 2026-08-25

- Documentation improvements: added README, fixed package description and documentation links.

## [0.0.1] - 2026-08-25

- Initial public release. React provider and hooks over an already-created browser client.
