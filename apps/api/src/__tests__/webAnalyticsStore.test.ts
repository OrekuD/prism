import { describe, expect, it } from "vitest";
import {
	type WebAnalyticsRawAggregates,
	assembleWebAnalytics,
	buildTrend,
	foldEntrySessions,
	suppressLocations,
	trendBucketFor,
	viewportWidthBucketLabel,
} from "../utils/webAnalyticsStore";

const HOUR = 3_600_000;
const DAY = 86_400_000;
const FROM = 1_785_542_400_000; // fixed epoch

function emptyAggregates(): WebAnalyticsRawAggregates {
	return {
		totals: {
			pageViews: 0,
			visitors: 0,
			sessions: 0,
			entrances: 0,
			botViews: 0,
			withTechnology: 0,
			withGeography: 0,
		},
		previousTotals: { pageViews: 0, visitors: 0, sessions: 0 },
		trendRows: [],
		pageRows: [],
		entrySessionRows: [],
		countries: [],
		regions: [],
		cities: [],
		browsers: [],
		operatingSystems: [],
		devices: [],
		viewports: [],
		languages: [],
	};
}

describe("web analytics assembler", () => {
	it("buckets hourly for ≤26h, daily through ~91d, weekly beyond", () => {
		expect(trendBucketFor(FROM, FROM + 24 * HOUR)).toBe("hourly");
		expect(trendBucketFor(FROM, FROM + 30 * DAY)).toBe("daily");
		expect(trendBucketFor(FROM, FROM + 180 * DAY)).toBe("weekly");
	});

	it("zero-fills trend buckets without interpolating activity", () => {
		const trend = buildTrend(
			[
				{
					bucketStart: FROM + HOUR * 5,
					pageViews: 7,
					visitors: 3,
					sessions: 3,
				},
			],
			FROM,
			FROM + 6 * HOUR,
		);
		expect(trend.bucket).toBe("hourly");
		expect(trend.points).toHaveLength(6);
		expect(trend.points.filter((p) => p.pageViews === 0)).toHaveLength(5);
		expect(trend.points[5]).toMatchObject({ pageViews: 7, visitors: 3 });
	});

	it("comparison: percent / new / no-prior-data per frozen §7 rules", () => {
		const agg = emptyAggregates();
		agg.totals = { ...agg.totals, pageViews: 110, visitors: 10, sessions: 10 };
		agg.previousTotals = { pageViews: 100, visitors: 20, sessions: 0 };
		const resource = assembleWebAnalytics(
			{
				projectId: "p",
				from: FROM,
				to: FROM + DAY,
				sourceIds: [],
				host: null,
				path: null,
				traffic: "human",
			},
			agg,
			DATE_NOW,
		);
		expect(resource.comparison.pageViews).toEqual({
			kind: "percent",
			direction: "up",
			percent: 10,
		});
		// Prior 20 → current 10 is a real down-percent.
		expect(resource.comparison.visitors).toEqual({
			kind: "percent",
			direction: "down",
			percent: -50,
		});
		// Sessions prior=0 current>0 → New (never ∞).
		expect(resource.comparison.sessions).toEqual({ kind: "new" });
	});

	it("bounce rate stays null until a session completes the 30-minute window", () => {
		const agg = emptyAggregates();
		const now = DATE_NOW;
		agg.entrySessionRows = [
			{
				session_id: "s_open",
				referrer_host: null,
				page_host: "acme.com",
				campaign_source: null,
				campaign_medium: null,
				campaign_name: null,
				person_id: "p1",
				first_seen: now - 60_000,
				last_activity: now - 30_000,
			},
		];
		agg.totals = { ...agg.totals, sessions: 1 };
		let resource = assembleWebAnalytics(baseParams(), agg, now);
		expect(resource.totals.bounceRate).toBeNull();

		// Completed single-page session → bounce 100%.
		agg.entrySessionRows = [
			{
				session_id: "s_done",
				referrer_host: "google.com",
				page_host: "acme.com",
				campaign_source: null,
				campaign_medium: null,
				campaign_name: null,
				person_id: "p2",
				// Single-page session: entry and last activity are the SAME view
				// (the loader's GROUP BY produces MIN==MAX for bounces).
				first_seen: now - 45 * 60_000,
				last_activity: now - 45 * 60_000,
			},
		];
		resource = assembleWebAnalytics(baseParams(), agg, now);
		expect(resource.totals.bounceRate).toBe(100);
		// Referrers[0] is ALWAYS the explicit Direct row; external follows sorted.
		expect(resource.referrers[0]).toMatchObject({ referrerHost: null });
		expect(resource.referrers[1]).toMatchObject({
			referrerHost: "google.com",
			sessions: 1,
		});
	});

	it("Direct counts only when there is no external referrer AND no campaign", () => {
		const now = DATE_NOW;
		const rowsIn = [
			{
				session_id: "s_direct",
				referrer_host: null,
				page_host: "acme.com",
				campaign_source: null,
				campaign_medium: null,
				campaign_name: null,
				person_id: "p1",
				first_seen: 0,
				last_activity: now - 40 * 60_000,
			},
			{
				session_id: "s_camp",
				referrer_host: null,
				page_host: "acme.com",
				campaign_source: "nl",
				campaign_medium: "email",
				campaign_name: "july",
				person_id: "p2",
				first_seen: 0,
				last_activity: now - 40 * 60_000,
			},
			{
				session_id: "s_ext",
				referrer_host: "bing.com",
				page_host: "acme.com",
				campaign_source: null,
				campaign_medium: null,
				campaign_name: null,
				person_id: "p3",
				first_seen: 0,
				last_activity: now - 40 * 60_000,
			},
		];
		const folded = foldEntrySessions(rowsIn, now);
		expect(folded.referrers[0]).toMatchObject({
			referrerHost: null,
			sessions: 1,
		}); // Direct
		expect(folded.referrers[1]).toMatchObject({ referrerHost: "bing.com" });
		expect(folded.campaigns).toHaveLength(1);
		expect(folded.campaignEntrySessions).toBe(1);
	});

	it("suppresses region/city groups under 5 sessions into Other, server-side", () => {
		const mk = (city: string, region: string, sessions: number) => ({
			countryCode: "US",
			region,
			city,
			sessions,
			visitors: sessions,
			pageViews: sessions * 2,
			sharePercent: 0,
		});
		const suppressed = suppressLocations([
			mk("Big City", "CA", 9),
			mk("Smallville", "CA", 2),
			mk("Tinytown", "OR", 1),
		]);
		expect(suppressed.map((r) => r.city)).toEqual(["Big City", "Other"]);
		expect(suppressed[1]?.sessions).toBe(3);
		// Countries are never suppressed.
	});
});

const DATE_NOW = FROM + 200 * DAY;

function baseParams() {
	return {
		projectId: "proj",
		from: FROM,
		to: FROM + DAY,
		sourceIds: [],
		host: null,
		path: null,
		traffic: "human" as const,
	};
}

it("viewport buckets are bounded labels, never exact fingerprint pairs", () => {
	expect(viewportWidthBucketLabel(375)).toBe("<480");
	expect(viewportWidthBucketLabel(null)).toBe("Unknown");
});
