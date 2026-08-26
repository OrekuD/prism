# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.0.3] - 2026-08-26

- Fixed published artifacts: builds now wipe dist/ first, so no stale files from earlier API generations ship in the tarball (`@prism-analytics/react` 0.0.2 contained dead `use-prism.js`/`prism-provider.js` from a pre-1.0 layout).

## [0.0.2] - 2026-08-25

- Documentation improvements: added README, fixed package description and documentation links.

## [0.0.1] - 2026-08-25

- Initial public release. Core queue, session, consent, sanitization, and wire envelope.
