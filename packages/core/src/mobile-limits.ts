/**
 * Frozen mobile limits (Task 18 slice 1).
 *
 * Mirrors PAGE_VIEW_LIMITS for Web but scoped to mobile app sessions,
 * screens, and installations. Every number here is a product decision
 * frozen in tasks/task-18.md §7 — changing it requires a task update.
 */

export const MOBILE_LIMITS = {
  /** App-session inactivity timeout — 30 minutes, same as Web. */
  appSessionInactivityTimeoutMs: 30 * 60 * 1000,
  /** Screen name ceiling — human-readable, bounded. */
  maxScreenNameLength: 128,
  /** Route pattern ceiling — normalized, no query/tokens. */
  maxRoutePatternLength: 512,
  /** Previous screen name ceiling. */
  maxPreviousScreenLength: 128,
  /** Custom screen property key ceiling. */
  maxScreenPropertyKeyLength: 64,
  /** Custom screen property string ceiling. */
  maxScreenPropertyStringLength: 1024,
  /** Installation random ID string ceiling before digest. */
  maxInstallationIdLength: 64,
  /** App release version ceiling (semver-ish). */
  maxAppVersionLength: 32,
  /** Build number ceiling. */
  maxBuildLength: 16,
  /** App environment label ceiling. */
  maxEnvironmentLength: 16,
  /** Dashboard range — 13 months, same as Web. */
  maxDashboardRangeMs: 366 * 24 * 60 * 60 * 1000,
  /** Ranking row ceiling. */
  rankingRowLimit: 50,
  /** City/region suppression threshold. */
  citySuppressionMinSessions: 5,
  /** Late delivery geo cutoff — 15 minutes, same as Web. */
  lateDeliveryGeoCutoffMs: 15 * 60 * 1000,
  /** Screen sequence ceiling per app session (bounded). */
  maxScreenSequence: 1_000_000,
} as const;

export const MOBILE_SESSION_TIMEOUT_MS = MOBILE_LIMITS.appSessionInactivityTimeoutMs;
