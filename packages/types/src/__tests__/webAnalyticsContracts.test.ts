import { describe, expect, it } from "vitest";
import {
	WEB_ANALYTICS_OTHER_LABEL,
	WEB_ANALYTICS_UNKNOWN_LABEL,
	type WebAnalyticsComparison,
	type WebAnalyticsResource,
} from "../network/resources";

/**
 * Task 17 slice 1 — dashboard read contract shape checks. The server owns
 * every number; these tests freeze the response anatomy the dashboard
 * renders against (metric names, null-bounce semantics, coverage labels).
 */
describe("web analytics contracts", () => {
	it("uses explicit Other/Unknown labels for privacy + enrichment gaps", () => {
		expect(WEB_ANALYTICS_OTHER_LABEL).toBe("Other");
		expect(WEB_ANALYTICS_UNKNOWN_LABEL).toBe("Unknown");
	});

	it("comparison values never encode infinity as a percent", () => {
		const comparison: WebAnalyticsComparison = {
			pageViews: { kind: "percent", direction: "up", percent: 12.5 },
			visitors: { kind: "new" },
			sessions: { kind: "no-prior-data" },
			viewsPerSession: { kind: "percent", direction: "flat", percent: 0 },
			bounceRate: null,
		};
		expect(comparison.pageViews.kind).toBe("percent");
		expect(comparison.visitors).toEqual({ kind: "new" });
		expect(comparison.bounceRate).toBeNull();
	});

	it("resource carries UTC range, filters, totals, trend bucket, and groups", () => {
		// Type-level fixture: compiles only with the frozen field set.
		const resource: WebAnalyticsResource = {
			range: {
				from: 1_785_542_400_000,
				to: 1_785_628_800_000,
				timezone: "UTC",
			},
			filters: { sourceIds: [], host: null, path: null, traffic: "human" },
			totals: {
				pageViews: 10,
				visitors: 4,
				sessions: 5,
				viewsPerSession: 2,
				bounceRate: null,
				excludedBots: 1,
			},
			comparison: {
				pageViews: { kind: "no-prior-data" },
				visitors: { kind: "no-prior-data" },
				sessions: { kind: "no-prior-data" },
				viewsPerSession: { kind: "no-prior-data" },
				bounceRate: null,
			},
			trend: { bucket: "daily", points: [] },
			pages: [],
			referrers: [
				{ referrerHost: null, sessions: 3, visitors: 2, sharePercent: 60 },
			],
			campaigns: [],
			locations: {
				countries: [],
				regions: [],
				cities: [],
				coveragePercent: 0,
			},
			technology: {
				browsers: [],
				operatingSystems: [],
				devices: [],
				viewports: [],
				languages: [],
				coveragePercent: 0,
			},
			coverage: {
				technologyPercent: 0,
				geographyPercent: 0,
				campaignPercent: 0,
			},
		};
		expect(resource.range.timezone).toBe("UTC");
		expect(resource.totals.bounceRate).toBeNull();
	});
});
