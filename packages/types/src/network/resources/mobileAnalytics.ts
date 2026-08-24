/**
 * Mobile analytics dashboard contracts (Task 18 slice 1).
 *
 * Mirrors webAnalytics.ts for React Native sources.
 */

export type MobileAnalyticsTotals = {
  appOpens: number;
  visitors: number;
  appSessions: number;
  avgScreensPerSession: number;
  /** null = insufficient completed sessions. */
  avgSessionDurationMs: number | null;
  observedInstallations: number;
  excludedBots: number;
};

export type MobileAnalyticsComparisonValue =
  | { kind: "percent"; direction: "up" | "down" | "flat"; percent: number }
  | { kind: "new" }
  | { kind: "no-prior-data" };

export type MobileAnalyticsComparison = {
  appOpens: MobileAnalyticsComparisonValue;
  visitors: MobileAnalyticsComparisonValue;
  appSessions: MobileAnalyticsComparisonValue;
  observedInstallations: MobileAnalyticsComparisonValue;
};

export type MobileAnalyticsTrendPoint = {
  bucketStartUtc: number;
  appOpens: number;
  visitors: number;
  appSessions: number;
};

export type MobileAnalyticsBucket = "hourly" | "daily" | "weekly";

export type MobileScreenRow = {
  name: string;
  routePattern: string | null;
  screenViews: number;
  visitors: number;
  entrances: number;
  sharePercent: number;
};

export type MobileReleaseRow = {
  version: string;
  build: string | null;
  screenViews: number;
  visitors: number;
  appSessions: number;
  sharePercent: number;
};

export type MobileInstallationRow = {
  firstSeenAt: number;
  lastSeenAt: number;
  screenViews: number;
};

export type MobileDeviceRow = {
  key: string;
  label: string;
  screenViews: number;
  visitors: number;
  sharePercent: number;
};

export const MOBILE_OTHER_LABEL = "Other";
export const MOBILE_UNKNOWN_LABEL = "Unknown";

export type MobileAnalyticsResource = {
  range: { from: number; to: number; timezone: "UTC" };
  filters: {
    sourceIds: string[];
    os: "ios" | "android" | null;
    release: string | null;
  };
  totals: MobileAnalyticsTotals;
  comparison: MobileAnalyticsComparison;
  trend: { bucket: MobileAnalyticsBucket; points: MobileAnalyticsTrendPoint[] };
  screens: MobileScreenRow[];
  releases: MobileReleaseRow[];
  installations: { observed: number; rows: MobileInstallationRow[] };
  technology: {
    devices: MobileDeviceRow[];
    operatingSystems: MobileDeviceRow[];
    sizeClasses: MobileDeviceRow[];
    coveragePercent: number;
  };
  locations: {
    countries: Array<{ countryCode: string | null; visitors: number; appSessions: number; sharePercent: number }>;
    regions: Array<{ countryCode: string | null; region: string | null; visitors: number; appSessions: number; sharePercent: number }>;
    cities: Array<{ countryCode: string | null; region: string | null; city: string | null; visitors: number; appSessions: number; sharePercent: number }>;
    coveragePercent: number;
  };
  coverage: {
    technologyPercent: number;
    geographyPercent: number;
  };
};

/** Projection row shape */
export type MobileScreenViewProjection = {
  projectId: string;
  eventId: string;
  occurredAt: number;
  screenName: string;
  routePattern: string | null;
  navigation: string;
  sequence: number;
  previousScreen: string | null;
  appVersion: string | null;
  appBuild: string | null;
  appEnvironment: string | null;
  os: "ios" | "android" | null;
  osVersion: string | null;
  installationDigest: string | null;
  countryCode: string | null;
  region: string | null;
  city: string | null;
};

export type MobileAnalyticsRequest = {
  from: number;
  to: number;
  sourceId?: string[];
  os?: "ios" | "android";
  release?: string;
};
