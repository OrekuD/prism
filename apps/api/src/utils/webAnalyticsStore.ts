import { PAGE_VIEW_LIMITS } from "@prism-analytics/core";
import type {
	WebAnalyticsBucket,
	WebAnalyticsCampaignRow,
	WebAnalyticsComparison,
	WebAnalyticsComparisonValue,
	WebAnalyticsLocationGroups,
	WebAnalyticsLocationRow,
	WebAnalyticsPageRow,
	WebAnalyticsReferrerRow,
	WebAnalyticsResource,
	WebAnalyticsTechnologyGroups,
	WebAnalyticsTechnologyRow,
} from "@prism-analytics/types";
import {
	WEB_ANALYTICS_OTHER_LABEL,
	WEB_ANALYTICS_UNKNOWN_LABEL,
} from "@prism-analytics/types";

/**
 * Bounded page-analytics read model (Task 17 slice 5).
 *
 * The accepted event stays the source of truth: sessions, people, sources,
 * and identity come from the LINKED events row, never from the projection.
 * Every query is parameterized; every ranking is capped at the frozen
 * 50-row ceiling; region/city privacy suppression runs SERVER-SIDE so
 * hidden small groups are not recoverable through filters.
 *
 * The pure assembler (`assembleWebAnalytics`) is unit-tested against
 * synthetic aggregates; the loaders only fetch grouped rows.
 */

export interface WebAnalyticsExecuteRow {
	[key: string]: unknown;
}

export interface WebAnalyticsExecuteClient {
	execute(input: {
		sql: string;
		args: Array<string | number | null>;
	}): Promise<{ rows: Array<Record<string, unknown>> }>;
}

export interface WebAnalyticsQueryParams {
	projectId: string;
	from: number;
	to: number;
	sourceIds: string[];
	host: string | null;
	path: string | null;
	traffic: "human" | "all";
}

/* ------------------------------------------------------------------ */
/* Pure helpers (unit-tested)                                          */
/* ------------------------------------------------------------------ */

export function trendBucketFor(from: number, to: number): WebAnalyticsBucket {
	const span = to - from;
	if (span <= 26 * 3_600_000) return "hourly";
	if (span <= 91 * 86_400_000) return "daily";
	return "weekly";
}

export function bucketMsFor(bucket: WebAnalyticsBucket): number {
	switch (bucket) {
		case "hourly":
			return 3_600_000;
		case "daily":
			return 86_400_000;
		case "weekly":
			return 7 * 86_400_000;
	}
}

export function viewportWidthBucketLabel(width: number | null): string {
	if (width === null) return WEB_ANALYTICS_UNKNOWN_LABEL;
	if (width < 480) return "<480";
	if (width < 768) return "480–767";
	if (width < 1024) return "768–1023";
	if (width < 1440) return "1024–1439";
	return "1440+";
}

function percent(part: number, whole: number): number {
	return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** §7: prior zero → New (current>0) / No prior data (both zero). */
function comparisonValue(
	current: number,
	prior: number,
): WebAnalyticsComparisonValue {
	if (prior === 0) {
		return current > 0 ? { kind: "new" } : { kind: "no-prior-data" };
	}
	const percentChange = Math.round(((current - prior) / prior) * 1000) / 10;
	const direction =
		percentChange > 0 ? "up" : percentChange < 0 ? "down" : "flat";
	return { kind: "percent", direction, percent: percentChange };
}

export interface SessionEntryRow {
	session_id: string | null;
	referrer_host: string | null;
	page_host: string;
	campaign_source: string | null;
	campaign_medium: string | null;
	campaign_name: string | null;
	person_id: string | null;
	first_seen: number;
	last_activity: number;
}

/**
 * Entry-session attribution + bounce eligibility. A session is COMPLETE
 * when its final observed activity is at least the frozen 30 minutes old —
 * still-open sessions are excluded from BOTH bounce sides and never claimed
 * as engaged/unengaged.
 */
export function foldEntrySessions(
	rows: SessionEntryRow[],
	nowMs: number,
	completedCutoffMs = PAGE_VIEW_LIMITS.webSessionInactivityTimeoutMs,
): {
	referrers: WebAnalyticsReferrerRow[];
	campaigns: WebAnalyticsCampaignRow[];
	bounceRate: number | null;
	directSessions: number;
	totalEntrySessions: number;
	campaignEntrySessions: number;
} {
	type NarrowedEntry = SessionEntryRow & { session_id: string };
	const bySession = new Map<string, NarrowedEntry>();
	for (const row of rows) {
		if (!row.session_id) continue;
		const narrowed = row as NarrowedEntry;
		const existing = bySession.get(row.session_id);
		// One row per session keeps FIRST-entry semantics (MIN(first_seen)).
		if (!existing || row.first_seen < existing.first_seen) {
			bySession.set(row.session_id, narrowed);
		}
	}

	let direct = 0;
	let campaignEntries = 0;
	let completed = 0;
	let completedBounces = 0;
	const referrerTally = new Map<
		string,
		{ sessions: Set<string>; visitors: Set<string> }
	>();
	const campaignTally = new Map<
		string,
		{
			label: {
				source: string | null;
				medium: string | null;
				name: string | null;
			};
			sessions: Set<string>;
			visitors: Set<string>;
		}
	>();

	for (const entry of bySession.values()) {
		const external =
			entry.referrer_host && entry.referrer_host !== entry.page_host
				? entry.referrer_host
				: null;
		const hasCampaign = Boolean(
			entry.campaign_source || entry.campaign_medium || entry.campaign_name,
		);
		if (hasCampaign) campaignEntries += 1;

		if (external) {
			const tally = referrerTally.get(external) ?? {
				sessions: new Set<string>(),
				visitors: new Set<string>(),
			};
			tally.sessions.add(entry.session_id);
			if (entry.person_id) tally.visitors.add(entry.person_id);
			referrerTally.set(external, tally);
		} else if (!hasCampaign) {
			direct += 1; // no external referrer AND no campaign → Direct
		}

		if (hasCampaign) {
			const key = `${entry.campaign_source ?? ""}|${entry.campaign_medium ?? ""}|${entry.campaign_name ?? ""}`;
			const tally = campaignTally.get(key) ?? {
				label: {
					source: entry.campaign_source,
					medium: entry.campaign_medium,
					name: entry.campaign_name,
				},
				sessions: new Set<string>(),
				visitors: new Set<string>(),
			};
			tally.sessions.add(entry.session_id);
			if (entry.person_id) tally.visitors.add(entry.person_id);
			campaignTally.set(key, tally);
		}

		// Completion: last observed activity for the WHOLE session, which the
		// loader provides via MAX(occurred_at) per session on the row.
		if (nowMs - entry.last_activity >= completedCutoffMs) {
			completed += 1;
			if (entry.last_activity - entry.first_seen === 0) {
				// Exactly one page view in this session (single entry row with a
				// zero span AND no later views — loader guarantees one row/session).
				completedBounces += 1;
			}
		}
	}

	const totalEntrySessions = bySession.size;
	const referrers: WebAnalyticsReferrerRow[] = [...referrerTally.entries()]
		.map(([host, tally]) => ({
			referrerHost: host,
			sessions: tally.sessions.size,
			visitors: tally.visitors.size,
			sharePercent: percent(tally.sessions.size, totalEntrySessions),
		}))
		.sort((a, b) => b.sessions - a.sessions)
		.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit);
	referrers.unshift({
		referrerHost: null, // Direct — explicit first row
		sessions: direct,
		visitors: 0, // Direct visitor counts fold into the totals strip
		sharePercent: percent(direct, totalEntrySessions),
	});

	const campaigns: WebAnalyticsCampaignRow[] = [...campaignTally.values()]
		.map((tally) => ({
			source: tally.label.source,
			medium: tally.label.medium,
			name: tally.label.name,
			sessions: tally.sessions.size,
			visitors: tally.visitors.size,
			sharePercent: percent(tally.sessions.size, totalEntrySessions),
		}))
		.sort((a, b) => b.sessions - a.sessions)
		.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit);

	return {
		referrers,
		campaigns,
		bounceRate:
			completed > 0
				? Math.round((completedBounces / completed) * 1000) / 10
				: null,
		directSessions: direct,
		totalEntrySessions,
		campaignEntrySessions: campaignEntries,
	};
}

/** Region/city suppression (<5 sessions → Other), applied server-side. */
export function suppressLocations(
	rows: Array<WebAnalyticsLocationRow & { city: string | null }>,
	minSessions = PAGE_VIEW_LIMITS.citySuppressionMinSessions,
): WebAnalyticsLocationRow[] {
	const kept = rows.filter((r) => r.sessions >= minSessions);
	const suppressed = rows.filter(
		(r) => r.sessions > 0 && r.sessions < minSessions,
	);
	if (suppressed.length === 0) return kept;
	const other: WebAnalyticsLocationRow = {
		countryCode: suppressed[0]?.countryCode ?? null,
		region: suppressed[0]?.region ?? null,
		city: WEB_ANALYTICS_OTHER_LABEL,
		sessions: suppressed.reduce((sum, r) => sum + r.sessions, 0),
		visitors: suppressed.reduce((sum, r) => sum + r.visitors, 0),
		pageViews: suppressed.reduce((sum, r) => sum + r.pageViews, 0),
		sharePercent: percent(
			suppressed.reduce((sum, r) => sum + r.sessions, 0),
			suppressed.reduce((sum, r) => sum + r.sessions, 0) || 1,
		),
	};
	return [...kept, other].sort((a, b) => b.sessions - a.sessions);
}

export interface TrendAggregateRow {
	bucketStart: number;
	pageViews: number;
	visitors: number;
	sessions: number;
}

/** Zero-fills explicit buckets — missing time NEVER renders as a gapless
 * fabricated series, and never interpolates activity. */
export function buildTrend(
	rows: TrendAggregateRow[],
	from: number,
	to: number,
): WebAnalyticsResource["trend"] {
	const bucket = trendBucketFor(from, to);
	const ms = bucketMsFor(bucket);
	const byKey = new Map(
		rows.map((r) => [Math.floor(r.bucketStart / ms) * ms, r]),
	);
	const points: WebAnalyticsResource["trend"]["points"] = [];
	for (let t = Math.floor(from / ms) * ms; t < to; t += ms) {
		const hit = byKey.get(t);
		points.push({
			bucketStartUtc: t,
			pageViews: hit?.pageViews ?? 0,
			visitors: hit?.visitors ?? 0,
			sessions: hit?.sessions ?? 0,
		});
	}
	return { bucket, points };
}

function techRows(
	groups: Array<{
		key: string;
		label: string;
		pageViews: number;
		visitors: number;
	}>,
	totalPageViews: number,
): WebAnalyticsTechnologyRow[] {
	return groups
		.map((g) => ({
			key: g.key,
			label: g.label,
			pageViews: g.pageViews,
			visitors: g.visitors,
			sharePercent: percent(g.pageViews, totalPageViews),
		}))
		.sort((a, b) => b.pageViews - a.pageViews)
		.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit);
}

/* ------------------------------------------------------------------ */
/* Assembler                                                           */
/* ------------------------------------------------------------------ */

export interface WebAnalyticsRawAggregates {
	totals: {
		pageViews: number;
		visitors: number;
		sessions: number;
		entrances: number;
		botViews: number;
		withTechnology: number;
		withGeography: number;
	};
	previousTotals: { pageViews: number; visitors: number; sessions: number };
	trendRows: TrendAggregateRow[];
	pageRows: Array<{
		path: string;
		title: string | null;
		host: string | null;
		pageViews: number;
		visitors: number;
		entrances: number;
	}>;
	entrySessionRows: SessionEntryRow[];
	countries: Array<{
		countryCode: string;
		pageViews: number;
		visitors: number;
		sessions: number;
	}>;
	regions: Array<{
		countryCode: string;
		region: string;
		pageViews: number;
		visitors: number;
		sessions: number;
	}>;
	cities: Array<{
		countryCode: string;
		region: string;
		city: string;
		pageViews: number;
		visitors: number;
		sessions: number;
	}>;
	browsers: Array<{
		family: string;
		major: number | null;
		pageViews: number;
		visitors: number;
	}>;
	operatingSystems: Array<{
		family: string;
		major: number | null;
		pageViews: number;
		visitors: number;
	}>;
	devices: Array<{ deviceType: string; pageViews: number; visitors: number }>;
	viewports: Array<{ bucket: string; pageViews: number; visitors: number }>;
	languages: Array<{ language: string; pageViews: number; visitors: number }>;
}

export function assembleWebAnalytics(
	params: WebAnalyticsQueryParams,
	raw: WebAnalyticsRawAggregates,
	nowMs: number,
): WebAnalyticsResource {
	const { from, to } = params;
	const totalsPv = raw.totals.pageViews;

	const pages: WebAnalyticsPageRow[] = raw.pageRows
		.map((row) => ({
			path: row.path,
			title: row.title,
			host: row.host,
			pageViews: row.pageViews,
			visitors: row.visitors,
			entrances: row.entrances,
			sharePercent: percent(row.pageViews, totalsPv),
			bounceRate: null, // per-page bounce requires session-completion joins (follow-up)
		}))
		.sort((a, b) => b.pageViews - a.pageViews)
		.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit);

	const folded = foldEntrySessions(raw.entrySessionRows, nowMs);

	const comparison: WebAnalyticsComparison = {
		pageViews: comparisonValue(totalsPv, raw.previousTotals.pageViews),
		visitors: comparisonValue(raw.totals.visitors, raw.previousTotals.visitors),
		sessions: comparisonValue(raw.totals.sessions, raw.previousTotals.sessions),
		viewsPerSession: comparisonValue(
			raw.totals.sessions > 0
				? Math.round((totalsPv / raw.totals.sessions) * 100) / 100
				: 0,
			raw.previousTotals.sessions > 0
				? Math.round(
						(raw.previousTotals.pageViews / raw.previousTotals.sessions) * 100,
					) / 100
				: 0,
		),
		bounceRate:
			folded.bounceRate === null
				? null
				: comparisonValue(folded.bounceRate, folded.bounceRate),
	};

	const devices: WebAnalyticsTechnologyGroups["devices"] = raw.devices
		.map((d) => ({
			key: d.deviceType,
			label: d.deviceType,
			deviceType: d.deviceType as WebAnalyticsTechnologyRow extends never
				? never
				: ReturnType<typeof deviceTypeOf>,
			pageViews: d.pageViews,
			visitors: d.visitors,
			sharePercent: percent(d.pageViews, totalsPv),
		}))
		.sort((a, b) => b.pageViews - a.pageViews)
		.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit);

	function deviceTypeOf(
		v: string,
	): WebAnalyticsTechnologyGroups["devices"][number]["deviceType"] {
		return v as WebAnalyticsDeviceTypeAlias;
	}

	const locations: WebAnalyticsLocationGroups = {
		countries: raw.countries
			.map((c) => ({
				countryCode: c.countryCode,
				region: null,
				city: null,
				sessions: c.sessions,
				visitors: c.visitors,
				pageViews: c.pageViews,
				sharePercent: percent(c.sessions, raw.totals.sessions || 1),
			}))
			.sort((a, b) => b.sessions - a.sessions)
			.slice(0, PAGE_VIEW_LIMITS.rankingRowLimit),
		regions: suppressLocations(
			raw.regions
				.map((c) => ({
					countryCode: c.countryCode,
					region: `${c.region}`,
					city: null,
					sessions: c.sessions,
					visitors: c.visitors,
					pageViews: c.pageViews,
					sharePercent: percent(c.sessions, raw.totals.sessions || 1),
				}))
				.sort((a, b) => b.sessions - a.sessions),
		).slice(0, PAGE_VIEW_LIMITS.rankingRowLimit),
		cities: suppressLocations(
			raw.cities
				.map((c) => ({
					countryCode: c.countryCode,
					region: `${c.region}`,
					city: `${c.city}`,
					sessions: c.sessions,
					visitors: c.visitors,
					pageViews: c.pageViews,
					sharePercent: percent(c.sessions, raw.totals.sessions || 1),
				}))
				.sort((a, b) => b.sessions - a.sessions),
		).slice(0, PAGE_VIEW_LIMITS.rankingRowLimit),
		coveragePercent: percent(raw.totals.withGeography, totalsPv),
	};

	const technology: WebAnalyticsTechnologyGroups = {
		browsers: techRows(
			raw.browsers.map((b) => ({
				key: `${b.family} ${b.major ?? ""}`.trim(),
				label: `${b.family}${b.major !== null && b.major !== undefined ? ` ${b.major}` : ""}`,
				pageViews: b.pageViews,
				visitors: b.visitors,
			})),
			totalsPv,
		),
		operatingSystems: techRows(
			raw.operatingSystems.map((o) => ({
				key: `${o.family} ${o.major ?? ""}`.trim(),
				label: `${o.family}${o.major !== null && o.major !== undefined ? ` ${o.major}` : ""}`,
				pageViews: o.pageViews,
				visitors: o.visitors,
			})),
			totalsPv,
		),
		devices,
		viewports: techRows(
			raw.viewports.map((v) => ({
				key: v.bucket,
				label: v.bucket,
				pageViews: v.pageViews,
				visitors: v.visitors,
			})),
			totalsPv,
		),
		languages: techRows(
			raw.languages.map((l) => ({
				key: l.language,
				label: l.language,
				pageViews: l.pageViews,
				visitors: l.visitors,
			})),
			totalsPv,
		),
		coveragePercent: percent(raw.totals.withTechnology, totalsPv),
	};

	return {
		range: { from, to, timezone: "UTC" },
		filters: {
			sourceIds: params.sourceIds,
			host: params.host,
			path: params.path,
			traffic: params.traffic,
		},
		totals: {
			pageViews: totalsPv,
			visitors: raw.totals.visitors,
			sessions: raw.totals.sessions,
			viewsPerSession:
				raw.totals.sessions > 0
					? Math.round((totalsPv / raw.totals.sessions) * 100) / 100
					: 0,
			bounceRate: folded.bounceRate,
			excludedBots: raw.totals.botViews,
		},
		comparison,
		trend: buildTrend(raw.trendRows, from, to),
		pages,
		referrers: folded.referrers,
		campaigns: folded.campaigns,
		locations,
		technology,
		coverage: {
			technologyPercent: technology.coveragePercent,
			geographyPercent: locations.coveragePercent,
			campaignPercent: percent(
				folded.campaignEntrySessions,
				folded.totalEntrySessions || 1,
			),
		},
	};
}

type WebAnalyticsDeviceTypeAlias =
	| "desktop"
	| "mobile"
	| "tablet"
	| "bot"
	| "unknown";
