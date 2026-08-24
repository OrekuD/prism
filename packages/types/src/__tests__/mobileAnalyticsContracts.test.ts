import { describe, it, expect } from "vitest";
import type { MobileAnalyticsResource } from "../network/resources/mobileAnalytics";
import { MOBILE_OTHER_LABEL, MOBILE_UNKNOWN_LABEL } from "../network/resources/mobileAnalytics";

describe("mobile analytics contracts", () => {
  it("freezes Other/Unknown labels", () => {
    expect(MOBILE_OTHER_LABEL).toBe("Other");
    expect(MOBILE_UNKNOWN_LABEL).toBe("Unknown");
  });
  it("comparison kinds include no-infinity", () => {
    const r: MobileAnalyticsResource = {
      range: { from: 0, to: 1, timezone: "UTC" },
      filters: { sourceIds: [], os: null, release: null },
      totals: { appOpens: 0, visitors: 0, appSessions: 0, avgScreensPerSession: 0, avgSessionDurationMs: null, observedInstallations: 0, excludedBots: 0 },
      comparison: {
        appOpens: { kind: "no-prior-data" },
        visitors: { kind: "new" },
        appSessions: { kind: "percent", direction: "up", percent: 10 },
        observedInstallations: { kind: "percent", direction: "flat", percent: 0 },
      },
      trend: { bucket: "daily", points: [] },
      screens: [],
      releases: [],
      installations: { observed: 0, rows: [] },
      technology: { devices: [], operatingSystems: [], sizeClasses: [], coveragePercent: 0 },
      locations: { countries: [], regions: [], cities: [], coveragePercent: 0 },
      coverage: { technologyPercent: 0, geographyPercent: 0 },
    };
    expect(r.totals.avgSessionDurationMs).toBeNull();
  });
});
