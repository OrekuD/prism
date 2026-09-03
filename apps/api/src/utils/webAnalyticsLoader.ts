import { PAGE_VIEW_LIMITS } from "@prism-analytics/core";
import type {
	WebAnalyticsBucket,
	WebAnalyticsResource,
} from "@prism-analytics/types";
import type { Context } from "hono";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import {
	type SessionEntryRow,
	type TrendAggregateRow,
	type WebAnalyticsExecuteClient,
	type WebAnalyticsQueryParams,
	type WebAnalyticsRawAggregates,
	assembleWebAnalytics,
	bucketMsFor,
} from "./webAnalyticsStore";

/**
 * SQL loaders for the page-analytics read model (Task 17 slice 5).
 *
 * Every query is fully parameterized; ranking GROUP BYs are capped at the
 * frozen 50-row ceiling after sort; the join to `events` supplies session,
 * person, and trusted source attribution so identity reconciliation
 * follows automatically. Raw projection only — rollups wait for hosted
 * query evidence.
 */

function buildWhere(
	params: WebAnalyticsQueryParams,
	aliases: { time: string; source?: string },
): { clauses: string[]; args: unknown[] } {
	const clauses = [
		"w.project_id = ?",
		`${aliases.time} >= ?`,
		`${aliases.time} < ?`,
	];
	const args: Array<string | number | null> = [
		params.projectId,
		params.from,
		params.to,
	];
	if (params.sourceIds.length > 0 && aliases.source) {
		clauses.push(
			`${aliases.source} IN (${params.sourceIds.map(() => "?").join(",")})`,
		);
		args.push(...params.sourceIds);
	}
	if (params.host) {
		clauses.push("w.host = ?");
		args.push(params.host);
	}
	if (params.path) {
		clauses.push("w.path = ?");
		args.push(params.path);
	}
	if (params.traffic === "human") {
		clauses.push("w.is_bot = 0");
	}
	if (params.asOf !== undefined) {
		// Every read-model query joins events (baseJoin); the cutoff rides
		// the same join so totals, comparisons, trends, and rankings agree.
		clauses.push("e.received_at <= ?");
		args.push(params.asOf);
	}
	return { clauses, args };
}

async function totalsFor(
	client: WebAnalyticsExecuteClient,
	params: WebAnalyticsQueryParams,
	from: number,
	to: number,
): Promise<
	WebAnalyticsRawAggregates["totals"] & {
		withTechnology: number;
		withGeography: number;
	}
> {
	const scoped = { ...params, from, to };
	const { clauses, args } = buildWhere(scoped, {
		time: "w.occurred_at",
		source: "e.source_id",
	});
	const result = await client.execute({
		sql: `SELECT
			COUNT(*) AS page_views,
			COUNT(DISTINCT e.person_id) AS visitors,
			COUNT(DISTINCT e.session_id) AS sessions,
			SUM(CASE WHEN w.page_sequence = 1 THEN 1 ELSE 0 END) AS entrances,
			SUM(CASE WHEN w.is_bot = 1 THEN 1 ELSE 0 END) AS bot_views,
			SUM(CASE WHEN w.browser_family IS NOT NULL THEN 1 ELSE 0 END) AS with_technology,
			SUM(CASE WHEN w.country_code IS NOT NULL THEN 1 ELSE 0 END) AS with_geography
		FROM web_page_views w
		JOIN events e ON e.project_id = w.project_id AND e.id = w.event_id
		WHERE ${clauses.join(" AND ")}`,
		args: args as Array<string | number | null>,
	});
	const row = (result.rows[0] ?? {}) as Record<string, unknown>;
	return {
		pageViews: Number(row.page_views ?? 0),
		visitors: Number(row.visitors ?? 0),
		sessions: Number(row.sessions ?? 0),
		entrances: Number(row.entrances ?? 0),
		botViews: Number(row.bot_views ?? 0),
		withTechnology: Number(row.with_technology ?? 0),
		withGeography: Number(row.with_geography ?? 0),
	};
}

export async function loadWebAnalytics(
	params: WebAnalyticsQueryParams,
	nowMs: number,
	client: WebAnalyticsExecuteClient,
): Promise<WebAnalyticsResource> {
	const bucket: WebAnalyticsBucket =
		params.to - params.from <= 26 * 3_600_000
			? "hourly"
			: params.to - params.from <= 91 * 86_400_000
				? "daily"
				: "weekly";
	const ms = bucketMsFor(bucket);
	const span = params.to - params.from;
	const previous = {
		from: params.from - span,
		to: params.from,
	};

	const scopedWhere = buildWhere(params, {
		time: "w.occurred_at",
		source: "e.source_id",
	});
	const baseJoin = `FROM web_page_views w
		JOIN events e ON e.project_id = w.project_id AND e.id = w.event_id`;

	// The libsql HTTP client used by Workers cannot safely multiplex this entire
	// read model. Keep the fixed query set sequential so every request settles
	// before the next one starts.
	const currentTotals = await totalsFor(client, params, params.from, params.to);
	const previousTotals = await totalsFor(
		client,
		params,
		previous.from,
		previous.to,
	);

	const trendResult = await client.execute({
		sql: `SELECT (w.occurred_at / ?) * ? AS bucket_start,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors,
					COUNT(DISTINCT e.session_id) AS sessions
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")}
				GROUP BY bucket_start ORDER BY bucket_start ASC`,
		args: [ms, ms, ...scopedWhere.args] as Array<string | number | null>,
	});

	const pageRows = await client.execute({
		sql: `SELECT w.path AS path,
					MAX(w.title) AS title,
					MAX(w.host) AS host,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors,
					SUM(CASE WHEN w.page_sequence = 1 THEN 1 ELSE 0 END) AS entrances
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")}
				GROUP BY w.path ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	// Entry rows only — one per session via MIN(occurred_at) grouping.
	const entryRows = await client.execute({
		sql: `SELECT e.session_id AS session_id,
					w.referrer_host AS referrer_host,
					w.host AS page_host,
					w.campaign_source AS campaign_source,
					w.campaign_medium AS campaign_medium,
					w.campaign_name AS campaign_name,
					e.person_id AS person_id,
					MIN(w.occurred_at) AS first_seen,
					MAX(w.occurred_at) AS last_activity
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")}
				GROUP BY e.session_id`,
		args: [...scopedWhere.args] as Array<string | number | null>,
	});

	const countries = await client.execute({
		sql: `SELECT w.country_code AS country_code,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors,
					COUNT(DISTINCT e.session_id) AS sessions
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.country_code IS NOT NULL
				GROUP BY w.country_code ORDER BY sessions DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const regions = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors,
					COUNT(DISTINCT e.session_id) AS sessions
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.region IS NOT NULL
				GROUP BY w.country_code, w.region ORDER BY sessions DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const cities = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region, w.city AS city,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors,
					COUNT(DISTINCT e.session_id) AS sessions
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.city IS NOT NULL
				GROUP BY w.country_code, w.region, w.city ORDER BY sessions DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const browsers = await client.execute({
		sql: `SELECT w.browser_family AS family, w.browser_major AS major,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.browser_family IS NOT NULL
				GROUP BY w.browser_family, w.browser_major ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const operatingSystems = await client.execute({
		sql: `SELECT w.os_family AS family, w.os_major AS major,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.os_family IS NOT NULL
				GROUP BY w.os_family, w.os_major ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const devices = await client.execute({
		sql: `SELECT w.device_type AS device_type,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")}
				GROUP BY w.device_type ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const viewports = await client.execute({
		sql: `SELECT CASE
						WHEN w.viewport_width IS NULL THEN 'Unknown'
						WHEN w.viewport_width < 480 THEN '<480'
						WHEN w.viewport_width < 768 THEN '480-767'
						WHEN w.viewport_width < 1024 THEN '768-1023'
						WHEN w.viewport_width < 1440 THEN '1024-1439'
						ELSE '1440+'
					END AS bucket,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")}
				GROUP BY bucket ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	const languages = await client.execute({
		sql: `SELECT w.primary_language AS language,
					COUNT(*) AS page_views,
					COUNT(DISTINCT e.person_id) AS visitors
				${baseJoin}
				WHERE ${scopedWhere.clauses.join(" AND ")} AND w.primary_language IS NOT NULL
				GROUP BY w.primary_language ORDER BY page_views DESC LIMIT ?`,
		args: [...scopedWhere.args, PAGE_VIEW_LIMITS.rankingRowLimit] as Array<
			string | number | null
		>,
	});

	function num(value: unknown): number {
		return Number(value ?? 0);
	}
	function rowsOf(result: { rows?: unknown }): Array<Record<string, unknown>> {
		const rows = (result as { rows?: unknown }).rows;
		return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
	}
	function str(value: unknown): string | null {
		return value === null || value === undefined ? null : String(value);
	}

	const raw: WebAnalyticsRawAggregates = {
		totals: currentTotals,
		previousTotals: {
			pageViews: previousTotals.pageViews,
			visitors: previousTotals.visitors,
			sessions: previousTotals.sessions,
		},
		trendRows: rowsOf(trendResult).map((row) => ({
			bucketStart: num(row.bucket_start),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
			sessions: num(row.sessions),
		})),
		pageRows: rowsOf(pageRows).map((row) => ({
			path: String(row.path ?? ""),
			title: str(row.title),
			host: str(row.host),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
			entrances: num(row.entrances),
		})),
		entrySessionRows: rowsOf(entryRows).map(
			(row): SessionEntryRow => ({
				session_id: str(row.session_id),
				referrer_host: str(row.referrer_host),
				page_host: String(row.page_host ?? ""),
				campaign_source: str(row.campaign_source),
				campaign_medium: str(row.campaign_medium),
				campaign_name: str(row.campaign_name),
				person_id: str(row.person_id),
				first_seen: num(row.first_seen),
				last_activity: num(row.last_activity),
			}),
		),
		countries: rowsOf(countries).map((row) => ({
			countryCode: String(row.country_code ?? ""),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
			sessions: num(row.sessions),
		})),
		regions: rowsOf(regions).map((row) => ({
			countryCode: String(row.country_code ?? ""),
			region: String(row.region ?? ""),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
			sessions: num(row.sessions),
		})),
		cities: rowsOf(cities).map((row) => ({
			countryCode: String(row.country_code ?? ""),
			region: String(row.region ?? ""),
			city: String(row.city ?? ""),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
			sessions: num(row.sessions),
		})),
		browsers: rowsOf(browsers).map((row) => ({
			family: String(row.family ?? ""),
			major:
				row.major === null || row.major === undefined
					? null
					: Number(row.major),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
		})),
		operatingSystems: rowsOf(operatingSystems).map((row) => ({
			family: String(row.family ?? ""),
			major:
				row.major === null || row.major === undefined
					? null
					: Number(row.major),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
		})),
		devices: rowsOf(devices).map((row) => ({
			deviceType: String(row.device_type ?? "unknown"),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
		})),
		viewports: rowsOf(viewports).map((row) => ({
			bucket: String(row.bucket ?? "Unknown"),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
		})),
		languages: rowsOf(languages).map((row) => ({
			language: String(row.language ?? ""),
			pageViews: num(row.page_views),
			visitors: num(row.visitors),
		})),
	};

	return assembleWebAnalytics(params, raw, nowMs);
}
