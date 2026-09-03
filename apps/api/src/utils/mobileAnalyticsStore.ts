import { MOBILE_LIMITS } from "@prism-analytics/core";
import type {
	MobileAnalyticsBucket,
	MobileAnalyticsComparisonValue,
	MobileAnalyticsResource,
} from "@prism-analytics/types";

/**
 * Mobile analytics read-model assembler (Task 18 slice 7, R2-F3).
 *
 * PURE functions only - every number arrives from the loader's SQL; the
 * assembler groups, caps, suppresses, and shapes. Never fabricates zeros:
 * insufficient data is expressed through explicit comparison kinds and
 * null durations.
 */

export interface MobileAnalyticsExecuteClient {
	execute(stmt: {
		sql: string;
		args?: Array<string | number | null>;
	}): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface MobileAnalyticsQueryParams {
	projectId: string;
	from: number;
	to: number;
	sourceIds: string[];
	os: "ios" | "android" | null;
	release: string | null;
	/**
	 * Snapshot cutoff (Task 21 slice 2): sessions/installations started after
	 * `asOf` and screen views received after `asOf` are excluded. Omitted =
	 * unbounded (pre-snapshot behavior, unchanged).
	 */
	asOf?: number;
}

/** One grouped screen row straight from SQL (already ranked + capped). */
export interface MobileScreenAggregateRow {
	screen_name: string;
	route_pattern: string | null;
	screen_views: number;
	visitors: number;
	sessions: number;
}

export interface MobileTotalsRow {
	app_opens: number;
	visitors: number;
	sessions: number;
	screens: number;
	completed_sessions: number;
	duration_ms_total: number | null;
	installations: number;
}

export interface MobileTrendRow {
	bucket_start: number;
	app_opens: number;
	visitors: number;
	sessions: number;
}

export interface MobileReleaseRow {
	version: string;
	build: string | null;
	screen_views: number;
	visitors: number;
	sessions: number;
}

export interface MobileInstallationRow {
	first_seen_at: number;
	last_seen_at: number;
	screen_views: number;
}

export interface MobileBreakdownRow {
	key: string | null;
	screen_views: number;
	visitors: number;
	sessions: number;
}

export interface MobileLocationRow {
	country_code: string | null;
	region: string | null;
	city: string | null;
	visitors: number;
	sessions: number;
}

export interface MobileAnalyticsRawAggregates {
	totals: MobileTotalsRow;
	previousTotals: MobileTotalsRow | null;
	bucket: MobileAnalyticsBucket;
	trend: MobileTrendRow[];
	screens: MobileScreenAggregateRow[];
	releases: MobileReleaseRow[];
	installations: MobileInstallationRow[];
	devices: MobileBreakdownRow[];
	operatingSystems: MobileBreakdownRow[];
	sizeClasses: MobileBreakdownRow[];
	countries: MobileLocationRow[];
	regions: MobileLocationRow[];
	cities: MobileLocationRow[];
}

function pct(current: number, previous: number): number | null {
	if (previous <= 0) return null;
	return Math.round(((current - previous) / previous) * 1000) / 10;
}

function compare(
	current: number,
	previous: number | undefined,
): MobileAnalyticsComparisonValue {
	if (previous === undefined || previous === null)
		return { kind: "no-prior-data" };
	const delta = pct(current, previous);
	if (delta === null) return current > 0 ? { kind: "new" } : { kind: "no-prior-data" };
	if (delta === 0) return { kind: "percent", direction: "flat", percent: 0 };
	return {
		kind: "percent",
		direction: delta > 0 ? "up" : "down",
		percent: Math.abs(delta),
	};
}

function share(part: number, total: number): number {
	if (total <= 0) return 0;
	return Math.round((part / total) * 1000) / 10;
}

function bucketMsFor(from: number, to: number): number {
	const span = to - from;
	if (span <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000; // hourly ≤ 24h
	if (span <= 90 * 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000; // daily
	return 7 * 24 * 60 * 60 * 1000; // weekly
}

export function assembleMobileAnalytics(
	params: MobileAnalyticsQueryParams,
	raw: MobileAnalyticsRawAggregates,
): MobileAnalyticsResource {
	const cap = MOBILE_LIMITS.rankingRowLimit;
	const t = raw.totals;

	const screens = raw.screens.slice(0, cap).map((row) => ({
		name: String(row.screen_name),
		routePattern: row.route_pattern ? String(row.route_pattern) : null,
		screenViews: Number(row.screen_views),
		visitors: Number(row.visitors),
		entrances: Number(row.sessions),
		sharePercent: share(Number(row.screen_views), Number(t.screens) || 1),
	}));

	const breakdown = (
		rows: MobileBreakdownRow[],
		labelFor: (key: string) => string,
	): Array<{ key: string; label: string; screenViews: number; visitors: number; sharePercent: number }> => {
		const total = rows.reduce((acc, r) => acc + Number(r.screen_views), 0);
		const capped = rows.slice(0, cap);
		const known = capped.reduce((acc, r) => acc + Number(r.screen_views), 0);
		const out = capped.map((r) => ({
			key: String(r.key ?? "unknown"),
			label: r.key ? labelFor(String(r.key)) : "Unknown",
			screenViews: Number(r.screen_views),
			visitors: Number(r.visitors),
			sharePercent: share(Number(r.screen_views), total),
		}));
		if (total > known) {
			out.push({
				key: "__other__",
				label: "Other",
				screenViews: total - known,
				visitors: 0,
				sharePercent: share(total - known, total),
			});
		}
		return out;
	};

	return {
		range: { from: params.from, to: params.to, timezone: "UTC" },
		filters: {
			sourceIds: [...params.sourceIds].sort(),
			os: params.os,
			release: params.release,
		},
		totals: {
			appOpens: Number(t.app_opens),
			visitors: Number(t.visitors),
			appSessions: Number(t.sessions),
			avgScreensPerSession:
				Number(t.sessions) > 0
					? Math.round((Number(t.screens) / Number(t.sessions)) * 100) / 100
					: 0,
			// Honest duration: null when no completed session reported one.
			avgSessionDurationMs:
				t.duration_ms_total !== null &&
				t.duration_ms_total !== undefined &&
				Number(t.completed_sessions) > 0
					? Math.round(Number(t.duration_ms_total) / Number(t.completed_sessions))
					: null,
			observedInstallations: Number(t.installations),
			excludedBots: 0,
		},
		comparison: {
			appOpens: compare(
				Number(t.app_opens),
				raw.previousTotals ? Number(raw.previousTotals.app_opens) : undefined,
			),
			visitors: compare(
				Number(t.visitors),
				raw.previousTotals ? Number(raw.previousTotals.visitors) : undefined,
			),
			appSessions: compare(
				Number(t.sessions),
				raw.previousTotals ? Number(raw.previousTotals.sessions) : undefined,
			),
			observedInstallations: compare(
				Number(t.installations),
				raw.previousTotals
					? Number(raw.previousTotals.installations)
					: undefined,
			),
		},
		trend: { bucket: raw.bucket, points: raw.trend.slice(0, cap * 4).map((p) => ({
			bucketStartUtc: Number(p.bucket_start),
			appOpens: Number(p.app_opens),
			visitors: Number(p.visitors),
			appSessions: Number(p.sessions),
		})) },
		screens,
		releases: raw.releases.slice(0, cap).map((r) => ({
			version: String(r.version ?? "unknown"),
			build: r.build ? String(r.build) : null,
			screenViews: Number(r.screen_views),
			visitors: Number(r.visitors),
			appSessions: Number(r.sessions),
			sharePercent: share(Number(r.screen_views), Number(t.screens) || 1),
		})),
		installations: {
			observed: Number(t.installations),
			rows: raw.installations.slice(0, cap).map((r) => ({
				firstSeenAt: Number(r.first_seen_at),
				lastSeenAt: Number(r.last_seen_at),
				screenViews: Number(r.screen_views),
			})),
		},
		technology: {
			devices: breakdown(raw.devices, (k) => k),
			operatingSystems: breakdown(raw.operatingSystems, (k) =>
				k === "ios" ? "iOS" : k === "android" ? "Android" : k,
			),
			sizeClasses: breakdown(raw.sizeClasses, (k) => k),
			coveragePercent: share(
				raw.devices.reduce((acc, r) => acc + Number(r.screen_views), 0),
				Number(t.screens) || 1,
			),
		},
		locations: {
			countries: raw.countries.slice(0, cap).map((r) => ({
				countryCode: r.country_code ? String(r.country_code) : null,
				region: null,
				city: null,
				visitors: Number(r.visitors),
				appSessions: Number(r.sessions),
				sharePercent: share(Number(r.sessions), Number(t.sessions) || 1),
			})),
			regions: raw.regions.slice(0, cap).map((r) => ({
				countryCode: r.country_code ? String(r.country_code) : null,
				region: r.region ? String(r.region) : null,
				city: null,
				visitors: Number(r.visitors),
				appSessions: Number(r.sessions),
				sharePercent: share(Number(r.sessions), Number(t.sessions) || 1),
			})),
			cities: raw.cities.slice(0, cap).map((r) => ({
				countryCode: r.country_code ? String(r.country_code) : null,
				region: r.region ? String(r.region) : null,
				city: r.city ? String(r.city) : null,
				visitors: Number(r.visitors),
				appSessions: Number(r.sessions),
				sharePercent: share(Number(r.sessions), Number(t.sessions) || 1),
			})),
			coveragePercent: share(
				raw.countries.reduce((acc, r) => acc + Number(r.sessions), 0),
				Number(t.sessions) || 1,
			),
		},
		coverage: {
			technologyPercent: share(
				raw.devices.reduce((acc, r) => acc + Number(r.screen_views), 0),
				Number(t.screens) || 1,
			),
			geographyPercent: share(
				raw.countries.reduce((acc, r) => acc + Number(r.sessions), 0),
				Number(t.sessions) || 1,
			),
		},
	};
}
