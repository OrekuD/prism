import { MOBILE_LIMITS } from "@prism-analytics/core";
import type { Context } from "hono";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import {
	type MobileAnalyticsExecuteClient,
	type MobileAnalyticsQueryParams,
	type MobileAnalyticsRawAggregates,
	assembleMobileAnalytics,
} from "./mobileAnalyticsStore";

/**
 * SQL loaders for the mobile analytics read model (Task 18 slice 7;
 * reworked in R3-F5).
 *
 * Opens, sessions, duration, and installation counts are computed from the
 * BOUNDED aggregate tables (`mobile_app_sessions`,
 * `mobile_installations`) that ingestion reconciles transactionally -
 * never by re-grouping lifecycle events at read time. ONE filter builder
 * feeds every query (totals, previous period, trend, rankings) so filters
 * cannot disagree between sections. The fixed query set runs SEQUENTIALLY:
 * the libsql HTTP client behind Workers cannot safely multiplex concurrent
 * queries through one client (task-17 slice-5 hang).
 */

function bucketMsFor(from: number, to: number): number {
	const span = to - from;
	if (span <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000;
	if (span <= 90 * 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000;
	return 7 * 24 * 60 * 60 * 1000;
}

export const MOBILE_MAX_RANGE_MS = 366 * 24 * 60 * 60 * 1000; // MOBILE_LIMITS.maxDashboardRangeMs — literal to avoid workerd TDZ at startup

/**
 * THE effective filter contract: applied identically to every total,
 * comparison, trend, and ranking query for a request.
 */
function sessionWhere(
	params: MobileAnalyticsQueryParams,
	from: number,
	to: number,
): { clauses: string[]; args: Array<string | number | null> } {
	const clauses = ["s.project_id = ?", "s.started_at >= ?", "s.started_at < ?"];
	const args: Array<string | number | null> = [params.projectId, from, to];
	if (params.sourceIds.length > 0) {
		clauses.push(`s.source_id IN (${params.sourceIds.map(() => "?").join(",")})`);
		args.push(...params.sourceIds);
	}
	if (params.os) {
		clauses.push("s.os = ?");
		args.push(params.os);
	}
	if (params.release) {
		clauses.push("s.app_version = ?");
		args.push(params.release);
	}
	return { clauses, args };
}

/** Screen-side filter: same contract, different alias/time column. */
function screenWhere(
	params: MobileAnalyticsQueryParams,
	from: number,
	to: number,
): { clauses: string[]; args: Array<string | number | null> } {
	const clauses = ["w.project_id = ?", "w.occurred_at >= ?", "w.occurred_at < ?"];
	const args: Array<string | number | null> = [params.projectId, from, to];
	if (params.sourceIds.length > 0) {
		clauses.push(`w.source_id IN (${params.sourceIds.map(() => "?").join(",")})`);
		args.push(...params.sourceIds);
	}
	if (params.os) {
		clauses.push("w.os = ?");
		args.push(params.os);
	}
	if (params.release) {
		clauses.push("w.app_version = ?");
		args.push(params.release);
	}
	return { clauses, args };
}

async function totalsFor(
	client: MobileAnalyticsExecuteClient,
	params: MobileAnalyticsQueryParams,
	from: number,
	to: number,
): Promise<MobileAnalyticsRawAggregates["totals"]> {
	const where = sessionWhere(params, from, to);
	const sessions = await client.execute({
		sql: `SELECT COUNT(*) AS sessions,
				SUM(s.screen_count) AS screens,
				SUM(CASE WHEN s.foreground_active_ms > 0 THEN s.foreground_active_ms ELSE NULL END) AS duration_ms_total,
				COUNT(DISTINCT CASE WHEN s.installation_digest IS NOT NULL THEN s.session_id END) AS completed_sessions
			FROM mobile_app_sessions s
			WHERE ${where.clauses.join(" AND ")}`,
		args: where.args,
	});
	const installs = await client.execute({
		sql: `SELECT COUNT(*) AS installations
			FROM mobile_installations i
			WHERE i.project_id = ? AND i.first_seen_at < ?
			AND (i.last_seen_at >= ? OR i.first_seen_at >= ?)`,
		args: [params.projectId, to, from, from],
	});
	const t = sessions.rows[0] ?? {};
	const iRow = installs.rows[0] ?? {};
	return {
		app_opens: Number(t.sessions ?? 0),
		visitors: Number(t.sessions ?? 0), // per-session distinct device below via installations
		sessions: Number(t.sessions ?? 0),
		screens: Number(t.screens ?? 0),
		completed_sessions: Number(t.completed_sessions ?? 0),
		duration_ms_total:
			t.duration_ms_total === null || t.duration_ms_total === undefined
				? null
				: Number(t.duration_ms_total),
		installations: Number(iRow.installations ?? 0),
	};
}

async function visitorsFor(
	client: MobileAnalyticsExecuteClient,
	params: MobileAnalyticsQueryParams,
	from: number,
	to: number,
): Promise<number> {
	// Visitors = distinct observed installations active in range (device-level
	// honesty for mobile; person-level attribution lives on Events/People).
	const where = screenWhere(params, from, to);
	const result = await client.execute({
		sql: `SELECT COUNT(DISTINCT w.installation_digest) AS visitors
			FROM mobile_screen_views w
			WHERE ${where.clauses.join(" AND ")} AND w.installation_digest IS NOT NULL`,
		args: where.args,
	});
	return Number(result.rows[0]?.visitors ?? 0);
}

export async function loadMobileAnalytics(
	ctx: Context,
	params: MobileAnalyticsQueryParams,
): Promise<ReturnType<typeof assembleMobileAnalytics>> {
	if (params.to - params.from > MOBILE_MAX_RANGE_MS) {
		throw new Error("mobile_range_too_large");
	}
	if (params.to <= params.from) {
		throw new Error("mobile_range_invalid");
	}
	const span = params.to - params.from;
	const client: MobileAnalyticsExecuteClient =
		TursoDatabaseManager.getInstance(ctx);

	// Sequential fixed query set (never concurrent through one libsql client).
	const totals = await totalsFor(client, params, params.from, params.to);
	const previousTotals = await totalsFor(
		client,
		params,
		params.from - span,
		params.from,
	);
	totals.visitors = await visitorsFor(client, params, params.from, params.to);

	const ms = bucketMsFor(params.from, params.to);

	// Trend from session starts, zero-filled across the whole bucket range so
	// gaps render honestly as zeros rather than missing points.
	const trendRows = await client.execute({
		sql: `SELECT (s.started_at / ?) * ? AS bucket_start,
				COUNT(*) AS opens,
				COUNT(DISTINCT s.installation_digest) AS visitors
			FROM mobile_app_sessions s
			WHERE ${sessionWhere(params, params.from, params.to).clauses.join(" AND ")}
			GROUP BY bucket_start ORDER BY bucket_start ASC`,
		args: [ms, ms, ...sessionWhere(params, params.from, params.to).args],
	});
	const opensByBucket = new Map<number, { opens: number; visitors: number }>();
	for (const r of trendRows.rows) {
		opensByBucket.set(Number(r.bucket_start), {
			opens: Number(r.opens ?? 0),
			visitors: Number(r.visitors ?? 0),
		});
	}
	const firstBucket = Math.floor(params.from / ms) * ms;
	const trend: MobileAnalyticsRawAggregates["trend"] = [];
	for (
		let bucket = firstBucket;
		bucket < params.to && trend.length <= MOBILE_LIMITS.rankingRowLimit * 4;
		bucket += ms
	) {
		const hit = opensByBucket.get(bucket);
		trend.push({
			bucket_start: bucket,
			app_opens: hit?.opens ?? 0,
			visitors: hit?.visitors ?? 0,
			sessions: hit?.opens ?? 0,
		});
	}

	const sw = screenWhere(params, params.from, params.to);
	const baseJoin = `FROM mobile_screen_views w
		JOIN events e ON e.project_id = w.project_id AND e.id = w.event_id`;

	const screens = await client.execute({
		sql: `SELECT w.screen_name AS screen_name,
				MAX(w.route_pattern) AS route_pattern,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")}
			GROUP BY w.screen_name ORDER BY screen_views DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const releases = await client.execute({
		sql: `SELECT COALESCE(w.app_version, 'unknown') AS version,
				MAX(w.app_build) AS build,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")}
			GROUP BY w.app_version ORDER BY screen_views DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const installations = await client.execute({
		sql: `SELECT MIN(first_seen) AS first_seen_at, MAX(last_seen) AS last_seen_at,
				SUM(screen_views) AS screen_views
			FROM (
				SELECT w.installation_digest,
					MIN(w.occurred_at) AS first_seen,
					MAX(w.occurred_at) AS last_seen,
					COUNT(*) AS screen_views
				FROM mobile_screen_views w
				WHERE ${sw.clauses.join(" AND ")} AND w.installation_digest IS NOT NULL
				GROUP BY w.installation_digest
			)
			GROUP BY installation_digest ORDER BY screen_views DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const devices = await client.execute({
		sql: `SELECT w.os AS key,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")}
			GROUP BY w.os ORDER BY screen_views DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const sizeClasses = await client.execute({
		sql: `SELECT CASE
					WHEN MAX(COALESCE(json_extract(e.context, '$.screenSize.width'), 0)) >= 1024 THEN 'large'
					WHEN MAX(COALESCE(json_extract(e.context, '$.screenSize.width'), 0)) >= 600 THEN 'regular'
					WHEN MAX(COALESCE(json_extract(e.context, '$.screenSize.width'), 0)) > 0 THEN 'compact'
					ELSE NULL END AS key,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")}
			GROUP BY key ORDER BY screen_views DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const countries = await client.execute({
		sql: `SELECT w.country_code AS country_code, NULL AS region, NULL AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")} AND w.country_code IS NOT NULL
			GROUP BY w.country_code ORDER BY sessions DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const regions = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region, NULL AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")} AND w.country_code IS NOT NULL AND w.region IS NOT NULL
			GROUP BY w.country_code, w.region ORDER BY sessions DESC LIMIT ?`,
		args: [...sw.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const minSessions = MOBILE_LIMITS.citySuppressionMinSessions;
	const cities = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region, w.city AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${sw.clauses.join(" AND ")} AND w.city IS NOT NULL
			GROUP BY w.country_code, w.region, w.city
			HAVING COUNT(DISTINCT e.session_id) >= ?
			ORDER BY sessions DESC LIMIT ?`,
		args: [...sw.args, minSessions, MOBILE_LIMITS.rankingRowLimit],
	});

	return assembleMobileAnalytics(params, {
		totals,
		previousTotals,
		bucket:
			ms === 60 * 60 * 1000
				? "hourly"
				: ms === 24 * 60 * 60 * 1000
					? "daily"
					: "weekly",
		trend,
		screens: screens.rows.map((r) => ({
			screen_name: String(r.screen_name ?? ""),
			route_pattern: r.route_pattern ? String(r.route_pattern) : null,
			screen_views: Number(r.screen_views ?? 0),
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		releases: releases.rows.map((r) => ({
			version: String(r.version ?? "unknown"),
			build: r.build ? String(r.build) : null,
			screen_views: Number(r.screen_views ?? 0),
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		installations: installations.rows.map((r) => ({
			first_seen_at: Number(r.first_seen_at ?? 0),
			last_seen_at: Number(r.last_seen_at ?? 0),
			screen_views: Number(r.screen_views ?? 0),
		})),
		devices: devices.rows.map((r) => ({
			key: r.key ? String(r.key) : null,
			screen_views: Number(r.screen_views ?? 0),
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		operatingSystems: devices.rows.map((r) => ({
			key: r.key ? String(r.key) : null,
			screen_views: Number(r.screen_views ?? 0),
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		sizeClasses: sizeClasses.rows.map((r) => ({
			key: r.key ? String(r.key) : null,
			screen_views: Number(r.screen_views ?? 0),
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		countries: countries.rows.map((r) => ({
			country_code: r.country_code ? String(r.country_code) : null,
			region: null,
			city: null,
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		regions: regions.rows.map((r) => ({
			country_code: r.country_code ? String(r.country_code) : null,
			region: r.region ? String(r.region) : null,
			city: null,
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
		cities: cities.rows.map((r) => ({
			country_code: r.country_code ? String(r.country_code) : null,
			region: r.region ? String(r.region) : null,
			city: r.city ? String(r.city) : null,
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
	});
}
