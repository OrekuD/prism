# Gates: Task 18 - review rounds 2+3 fixes (2026-08-25)

OWNS: apps/analytics-api/db/migrations/013_mobile_screen_views.sql, apps/analytics-api/src/controllers/IngestController.ts, apps/analytics-api/src/enrichment/mobileScreenView.ts, apps/analytics-api/src/database/reset.ts, apps/analytics-api/src/retention.ts, apps/api/src/controllers/ProjectsController.ts, apps/api/src/routers/ProjectsRouter.ts, apps/api/src/controllers/SourcesController.ts, apps/web/src/App.tsx, apps/web/src/routes/projects/project/mobile-analytics.tsx, apps/web/src/components/layout/sidebar.tsx, apps/web/src/lib/workspace.ts, apps/web/src/network/queries/useMobileAnalyticsQuery.ts, packages/react-native/**, packages/core/src/screen-view.ts, packages/core/src/limits.ts, tasks/task-18.md

Scope: Fix all round-2 and round-3 findings (honest gates, real mobile ingestion pass + projections, authorized mobile endpoint with real SQL loader, factory-owned lifecycle/session, retention/deletion cleanup) and prove each with the actual quality command's exit status.

- [x] G1: Analytics migrations apply from empty store twice, reset drops every table (incl. mobile), retention sweeps mobile orphans
  CHECK: cd apps/analytics-api && yarn test src/__tests__/migrations.test.ts src/__tests__/retention.test.ts && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=GATE_OK | warning package.json: No license field

- [x] G2: RN package builds AND delivers real reserved screen/lifecycle records through the internal seam with a real Core client
  CHECK: cd packages/react-native && yarn build && yarn test src/__tests__/react-native.test.ts src/__tests__/surface-contract.test.ts && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=warning package.json: No license field | warning package.json: No license field

- [x] G3: Analytics API typechecks (Web page-view import restored) and full analytics suite passes with mobile ingestion wired
  CHECK: cd apps/analytics-api && yarn typecheck && yarn test src/__tests__/mobileIngest.test.ts src/__tests__/migrations.test.ts && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=warning package.json: No license field | warning package.json: No license field

- [x] G4: Mobile endpoint follows getWebAnalytics boundary (no client workspace header, parameterized slug, Turso analytics reads); Product API typechecks
  CHECK: cd apps/api && yarn typecheck && yarn test && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=stderr | src/__tests__/authBoundary.test.ts > Better Auth boundary (email/password + sessions) > does not expose GitHub or Google providers when credentials are absent | 2026-08-25T03:57:58.768Z ERROR [Better Auth]: Provider not found. Make

- [x] G5: Web typechecks; Mobile analytics page uses axiosInstance v1 query module (no raw fetch)
  CHECK: node scripts/check-mobile-web.mjs && cd apps/web && yarn typecheck && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=Done in 3.60s. | GATE_OK

- [x] G6: RN runtime derives os from Platform.OS, never Math.random, test reset not exported as public API
  CHECK: cd packages/react-native && yarn test && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=GATE_OK | warning package.json: No license field

- [x] G7: Core suite passes with normalized reserved-event queueing (screen + lifecycle validators omit undefined fields)
  CHECK: cd packages/core && yarn build && yarn test && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=npm warn Unknown env config "version-tag-prefix". This will stop working in the next major version of npm. See `npm help npmrc` for supported config options. | npm warn Unknown project config "auto-install-peers". This will stop working in 

- [x] G8: Source creation UI offers only creatable platforms (web/react-native/server); iOS/Android remain readable reserved values
  CHECK: node scripts/check-creatable-platforms.mjs && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=G8 verification passed: UI and API creatable platforms in parity | GATE_OK

- [x] G9: Task log contains no unsupported hosted/device claims; slices 9-10 entry is marked superseded
  CHECK: node scripts/check-task18-honesty.mjs && echo GATE_OK
  EXPECT: GATE_OK
  EVIDENCE: exit=0; shell=/bin/sh; cwd=/Users/david/Desktop/Oreku/code/prep/projects/prism; path=dc8bf65ffdd5/47 entries; output=G9 verification passed: progress log is honest | GATE_OK
