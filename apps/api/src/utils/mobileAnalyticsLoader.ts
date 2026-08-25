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
 * SQL loaders for the mobile analytics read model (Task 18 slice 7, R2-F3).
 *
 * Every query is bounded: time-scoped per project first, ranked rows capped
 * at the frozen MOBILE_LIMITS.rankingRowLimit, and the fixed set runs
 * SEQUENTIALLY - the libsql HTTP client behind Workers cannot safely
 * multiplex concurrent queries through one client (task-17 slice-5 hang).
 */

function bucketMsFor(from: number, to: number): number {
	const span = to - from;
	if (span <= 24 * 60 * 60 * 1000) return 60 * 60 * 1000;
	if (span <= 90 * 24 * 60 * 60 * 1000) return 24 * 60 * 60 * 1000;
	return 7 * 24 * 60 * 60 * 1000;
}

export const MOBILE_MAX_RANGE_MS = MOBILE_LIMITS.maxDashboardRangeMs;

function buildWhere(
	params: MobileAnalyticsQueryParams,
): { clauses: string[]; args: Array<string | number | null> } {
	const clauses = [
		"w.project_id = ?",
		"w.occurred_at >= ?",
		"w.occurred_at < ?",
	];
	const args: Array<string | number | null> = [
		params.projectId,
		params.from,
		params.to,
	];
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
	const where = buildWhere({ ...params, from, to });
	const base = `FROM mobile_screen_views w WHERE ${where.clauses.join(" AND ")}`;
	const totals = await client.execute({
		sql: `SELECT COUNT(DISTINCT e.session_id) AS sessions,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(*) AS screens,
				COUNT(DISTINCT w.installation_digest) AS installations
			FROM mobile_screen_views w JOIN events e ON e.project_id = w.project_id AND e.id = w.event_id
			WHERE ${where.clauses.join(" AND ")}`,
		args: where.args,
	});
	// App opens = lifecycle active records in range (bounded table read via
	// the event join; lifecycle records live only in events).
	const opens = await client.execute({
		sql: `SELECT COUNT(*) AS app_opens FROM events e
			WHERE e.project_id = ? AND e.name = '$prism_app_lifecycle'
			AND e.occurred_at >= ? AND e.occurred_at < ?
			AND e.session_id IN (
				SELECT DISTINCT session_id FROM mobile_screen_views w
				WHERE ${where.clauses.join(" AND ")}
			)`,
		args: [params.projectId, from, to, ...where.args],
	});
	// Honest duration: completed background intervals reported this period.
	const duration = await client.execute({
		sql: `SELECT COUNT(*) AS completed_sessions, SUM(CAST(json_extract(e.properties, '$.$lifecycle.durationMs') AS INTEGER)) AS duration_ms_total
			FROM events e
			WHERE e.project_id = ? AND e.name = '$prism_app_lifecycle'
			AND e.occurred_at >= ? AND e.occurred_at < ?
			AND json_extract(e.properties, '$.$lifecycle.transition') = 'background'
			AND json_extract(e.properties, '$.$lifecycle.durationMs') IS NOT NULL`,
		args: [params.projectId, from, to],
	});
	const t = totals.rows[0] ?? {};
	const o = opens.rows[0] ?? {};
	const d = duration.rows[0] ?? {};
	return {
		app_opens: Number(o.app_opens ?? 0),
		visitors: Number(t.visitors ?? 0),
		sessions: Number(t.sessions ?? 0),
		screens: Number(t.screens ?? 0),
		completed_sessions: Number(d.completed_sessions ?? 0),
		duration_ms_total:
			d.duration_ms_total === null || d.duration_ms_total === undefined
				? null
				: Number(d.duration_ms_total),
		installations: Number(t.installations ?? 0),
	};
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

	const where = buildWhere(params);
	const baseJoin = `FROM mobile_screen_views w
		JOIN events e ON e.project_id = w.project_id AND e.id = w.event_id`;

	// Sequential fixed query set (never Promise.all through one libsql client).
	const totals = await totalsFor(client, params, params.from, params.to);
	const previousTotals = await totalsFor(
		client,
		params,
		params.from - span,
		params.from,
	);

	const ms = bucketMsFor(params.from, params.to);
	const trend = await client.execute({
		sql: `SELECT (w.occurred_at / ?) * ? AS bucket_start,
				COUNT(*) AS screens,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")}
			GROUP BY bucket_start ORDER BY bucket_start ASC`,
		args: [ms, ms, ...where.args],
	});

	const screens = await client.execute({
		sql: `SELECT w.screen_name AS screen_name,
				MAX(w.route_pattern) AS route_pattern,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")}
			GROUP BY w.screen_name ORDER BY screen_views DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const releases = await client.execute({
		sql: `SELECT COALESCE(w.app_version, 'unknown') AS version,
				MAX(w.app_build) AS build,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")}
			GROUP BY w.app_version ORDER BY screen_views DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
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
				WHERE ${where.clauses.join(" AND ")} AND w.installation_digest IS NOT NULL
				GROUP BY w.installation_digest
			)
			GROUP BY installation_digest ORDER BY screen_views DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const devices = await client.execute({
		sql: `SELECT w.os AS key,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")}
			GROUP BY w.os ORDER BY screen_views DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const operatingSystems = devices; // same source dimension for now

	const sizeClasses = await client.execute({
		sql: `SELECT CASE
					WHEN MAX(COALESCE(json_extract(e.context, '$.windowWidth'), 0)) >= 1024 THEN 'large'
					WHEN MAX(COALESCE(json_extract(e.context, '$.windowWidth'), 0)) >= 600 THEN 'regular'
					WHEN MAX(COALESCE(json_extract(e.context, '$.windowWidth'), 0)) > 0 THEN 'compact'
					ELSE NULL END AS key,
				COUNT(*) AS screen_views,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")}
			GROUP BY key ORDER BY screen_views DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const countries = await client.execute({
		sql: `SELECT w.country_code AS country_code, NULL AS region, NULL AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")} AND w.country_code IS NOT NULL
			GROUP BY w.country_code ORDER BY sessions DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	const regions = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region, NULL AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")} AND w.country_code IS NOT NULL AND w.region IS NOT NULL
			GROUP BY w.country_code, w.region ORDER BY sessions DESC LIMIT ?`,
		args: [...where.args, MOBILE_LIMITS.rankingRowLimit],
	});

	// Frozen suppression: cities under the session threshold collapse to Other.
	const minSessions = MOBILE_LIMITS.citySuppressionMinSessions;
	const cities = await client.execute({
		sql: `SELECT w.country_code AS country_code, w.region AS region, w.city AS city,
				COUNT(DISTINCT e.person_id) AS visitors,
				COUNT(DISTINCT e.session_id) AS sessions
			${baseJoin}
			WHERE ${where.clauses.join(" AND ")} AND w.city IS NOT NULL
			GROUP BY w.country_code, w.region, w.city
			HAVING COUNT(DISTINCT e.session_id) >= ?
			ORDER BY sessions DESC LIMIT ?`,
		args: [...where.args, minSessions, MOBILE_LIMITS.rankingRowLimit],
	});

	return assembleMobileAnalytics(params, {
		totals,
		previousTotals,
		bucket:
			ms === 60 * 60 * 1000 ? "hourly" : ms === 24 * 60 * 60 * 1000 ? "daily" : "weekly",
		trend: trend.rows.map((r) => ({
			bucket_start: Number(r.bucket_start),
			app_opens: 0,
			visitors: Number(r.visitors ?? 0),
			sessions: Number(r.sessions ?? 0),
		})),
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
		operatingSystems: operatingSystems.rows.map((r) => ({
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
