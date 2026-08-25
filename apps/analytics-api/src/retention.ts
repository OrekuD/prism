/**
 * Analytics retention CLI (task-6 closure, task-9 slice 5 rework).
 *
 * Deletes expired analytics data from the store (Turso/libSQL):
 * - v2 `events` by `received_at` (server clock — the retention timestamp);
 * - v2 `sessions_v2` by `last_seen_at`;
 * - identity links, traits, and people by `last_seen_at` (task-10 §4) —
 *   events first, then links/traits, then people: dependency-safe order
 *   in ONE atomic write batch;
 * - error tracking (task-15): `error_occurrences` by `received_at`, then
 *   `error_issue_users` and `error_issues` whose occurrences are ALL
 *   expired — no personally identifying orphan records, no phantom
 *   counters.
 *
 * The legacy v1 tables were dropped with the v1 routes (task-9 slice 6).
 *
 * Every deletion happens in ONE atomic write batch (events before
 * sessions — dependents first), so a failure rolls back everything.
 *
 * Usage:
 *   yarn workspace prism-analytics-api retention --status    # config + counts (read-only)
 *   yarn workspace prism-analytics-api retention --dry-run   # what would be deleted
 *   yarn workspace prism-analytics-api retention             # apply deletion
 *
 * ANALYTICS_RETENTION_DAYS:
 *   unset or 0 disables deletion (the default — no surprise data loss);
 *   a positive integer enables batched deletion of expired rows.
 *
 * ERROR_RETENTION_DAYS:
 *   documented separately from event retention (task-15); same semantics
 *   for the error tracking tables, so error payloads can be kept on a
 *   different window than analytics events.
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote stores).
 */
import { type Client, type InStatement, createClient } from "@libsql/client";
import { config } from "dotenv";
import { logger } from "./utils/logger.js";
import { errorMetrics } from "./utils/errorMetrics.js";

config();

/** Parse ANALYTICS_RETENTION_DAYS; unset/empty/0 = disabled. Throws on invalid input. */
export function parseRetentionDays(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return 0;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			`ANALYTICS_RETENTION_DAYS must be a non-negative integer, got "${raw}". Unset or 0 disables retention deletion.`,
		);
	}
	return value;
}

/** Parse ERROR_RETENTION_DAYS; unset/empty/0 = disabled. Throws on invalid input. */
export function parseErrorRetentionDays(raw: string | undefined): number {
	if (raw === undefined || raw.trim() === "") return 0;
	const value = Number(raw);
	if (!Number.isInteger(value) || value < 0) {
		throw new Error(
			`ERROR_RETENTION_DAYS must be a non-negative integer, got "${raw}". Unset or 0 disables error retention deletion.`,
		);
	}
	return value;
}

/** SQLite CURRENT_TIMESTAMP format (UTC) for a cutoff `days` ago (legacy v1 tables). */
export function retentionCutoff(days: number): string {
	const cutoff = new Date(Date.now() - days * 86_400_000);
	return cutoff.toISOString().replace("T", " ").slice(0, 19);
}

/** Epoch milliseconds cutoff (v2 tables store INTEGER ms timestamps). */
export function retentionCutoffMs(days: number): number {
	return Date.now() - days * 86_400_000;
}

export interface RetentionStats {
	enabled: boolean;
	retentionDays: number;
	/** v2 events (received_at) */
	events: { total: number; expired: number };
	/** v2 sessions (last_seen_at) */
	sessions: { total: number; expired: number };
	/** people (last_seen_at) — task-10 */
	people: { total: number; expired: number };
	/** error tracking (task-15): occurrences by received_at + orphaned issues */
	errors: {
		occurrences: { total: number; expired: number };
		/** issues whose occurrences are ALL expired (pruned with them) */
		orphanedIssues: number;
		/** workflow-activity rows on issues that are fully expired (pruned) */
		orphanedActivity: number;
	};
}

const countOf = (result: { rows: Array<Record<string, unknown>> }): number =>
	Number(result.rows[0]?.n ?? 0);

/** Existing table names (legacy tables are optional on fresh stores). */
export async function existingTables(client: Client): Promise<Set<string>> {
	const { rows } = await client.execute(
		"SELECT name FROM sqlite_master WHERE type = 'table'",
	);
	return new Set(rows.map((row) => String(row.name)));
}

export async function retentionStats(
	client: Client,
	days: number,
	errorDays = days,
): Promise<RetentionStats> {
	const cutoffMs = retentionCutoffMs(days);
	const none = Promise.resolve({ rows: [{ n: 0 }] }) as never;
	const hasErrorTables = (await existingTables(client)).has(
		"error_occurrences",
	);
	const errorCutoffMs = retentionCutoffMs(errorDays);

	const [events, sessions, people, errors] = await Promise.all([
		Promise.all([
			client.execute("SELECT COUNT(*) AS n FROM events"),
			days > 0
				? client.execute({
						sql: "SELECT COUNT(*) AS n FROM events WHERE received_at < ?",
						args: [cutoffMs],
					})
				: none,
		]),
		Promise.all([
			client.execute("SELECT COUNT(*) AS n FROM sessions_v2"),
			days > 0
				? client.execute({
						sql: "SELECT COUNT(*) AS n FROM sessions_v2 WHERE last_seen_at < ?",
						args: [cutoffMs],
					})
				: none,
		]),
		Promise.all([
			client.execute("SELECT COUNT(*) AS n FROM people"),
			days > 0
				? client.execute({
						sql: "SELECT COUNT(*) AS n FROM people WHERE last_seen_at < ?",
						args: [cutoffMs],
					})
				: none,
		]),
		Promise.all([
			hasErrorTables
				? client.execute("SELECT COUNT(*) AS n FROM error_occurrences")
				: none,
			hasErrorTables && errorDays > 0
				? client.execute({
						sql: "SELECT COUNT(*) AS n FROM error_occurrences WHERE received_at < ?",
						args: [errorCutoffMs],
					})
				: none,
			hasErrorTables && errorDays > 0
				? client.execute({
						sql: `SELECT COUNT(*) AS n FROM error_issues WHERE id NOT IN (
              SELECT DISTINCT issue_id FROM error_occurrences
              WHERE received_at >= ?)`,
						args: [errorCutoffMs],
					})
				: none,
			hasErrorTables && errorDays > 0
				? client.execute({
						sql: `SELECT COUNT(*) AS n FROM error_issue_activity WHERE issue_id NOT IN (
              SELECT DISTINCT issue_id FROM error_occurrences)`,
						args: [],
					})
				: none,
		]),
	]);

	return {
		enabled: days > 0 || errorDays > 0,
		retentionDays: days,
		events: { total: countOf(events[0]), expired: countOf(events[1]) },
		sessions: { total: countOf(sessions[0]), expired: countOf(sessions[1]) },
		people: { total: countOf(people[0]), expired: countOf(people[1]) },
		errors: {
			occurrences: { total: countOf(errors[0]), expired: countOf(errors[1]) },
			orphanedIssues: countOf(errors[2]),
			orphanedActivity: countOf(errors[3]),
		},
	};
}

export interface RetentionResult {
	deletedEvents: number;
	deletedSessions: number;
	deletedPeople: number;
	deletedErrorOccurrences: number;
	deletedErrorUsers: number;
	deletedErrorActivity: number;
	deletedErrorIssues: number;
}

/**
 * Delete expired rows in ONE atomic write batch, dependents first
 * (events before sessions — the v1 model links events to sessions).
 * The error pass (task-15) runs in the same batch when the error tables
 * exist: occurrences first, then user links and issues whose occurrences
 * are ALL expired — no PII orphans, no phantom counters.
 */
export async function applyRetention(
	client: Client,
	days: number,
	errorDays = days,
): Promise<RetentionResult> {
	if (days <= 0 && errorDays <= 0) {
		return {
			deletedEvents: 0,
			deletedSessions: 0,
			deletedPeople: 0,
			deletedErrorOccurrences: 0,
			deletedErrorUsers: 0,
			deletedErrorActivity: 0,
			deletedErrorIssues: 0,
		};
	}
	const cutoffMs = retentionCutoffMs(days);
	const projectId = "any";
	const errorCutoffMs = retentionCutoffMs(errorDays);
	const hasErrorTables = (await existingTables(client)).has(
		"error_occurrences",
	);

	// Dependency-safe order in ONE atomic batch (task-10 §4): events →
	// sessions → identity links → traits → people, then error occurrences
	// → error user links → orphaned error issues. F6: every dependent
	// delete is scoped by project_id AND the expired person set — an
	// expired person never takes the whole project's links or traits.
	const statements: InStatement[] = [
		{ sql: "DELETE FROM events WHERE received_at < ?", args: [cutoffMs] },
		{ sql: "DELETE FROM sessions_v2 WHERE last_seen_at < ?", args: [cutoffMs] },
		{
			sql: "DELETE FROM external_identities WHERE person_id IN (SELECT person_id FROM people WHERE last_seen_at < ?)",
			args: [cutoffMs],
		},
		{
			sql: "DELETE FROM anonymous_identities WHERE person_id IN (SELECT person_id FROM people WHERE last_seen_at < ?)",
			args: [cutoffMs],
		},
		{
			sql: "DELETE FROM person_traits WHERE person_id IN (SELECT person_id FROM people WHERE last_seen_at < ?)",
			args: [cutoffMs],
		},
		{ sql: "DELETE FROM people WHERE last_seen_at < ?", args: [cutoffMs] },
	];
	// Task 17 slice 4: projections whose linked event was just expired are
	// swept in the SAME batch - no orphan web_page_views row survives
	// retention (guarded by table existence for pre-migration stores).
	if ((await existingTables(client)).has("web_page_views")) {
		statements.push({
			sql: "DELETE FROM web_page_views WHERE event_id NOT IN (SELECT id FROM events WHERE project_id = web_page_views.project_id)",
			args: [],
		});
	}
	// Task 18 (R2-F5): mobile projections + aggregates. Screen views cascade
	// with their event via FK; this sweep catches rows that lost their event
	// through any path. Sessions/installations have NO event FK and are
	// garbage-collected from the surviving projection set.
	const tables = await existingTables(client);
	if (tables.has("mobile_screen_views")) {
		statements.push({
			sql: "DELETE FROM mobile_screen_views WHERE event_id NOT IN (SELECT id FROM events WHERE project_id = mobile_screen_views.project_id)",
			args: [],
		});
	}
	if (tables.has("mobile_app_sessions") && tables.has("mobile_screen_views")) {
		statements.push({
			sql: `DELETE FROM mobile_app_sessions WHERE project_id || ':' || session_id NOT IN (
				SELECT project_id || ':' || session_id FROM mobile_screen_views
			)`,
			args: [],
		});
	}
	if (
		tables.has("mobile_installations") &&
		tables.has("mobile_app_sessions")
	) {
		statements.push({
			sql: `DELETE FROM mobile_installations WHERE project_id || ':' || installation_digest NOT IN (
				SELECT project_id || ':' || installation_digest FROM mobile_app_sessions
				WHERE installation_digest IS NOT NULL
			)`,
			args: [],
		});
	}
	let errorOccurrenceIndex = -1;
	let errorUsersIndex = -1;
	let errorActivityIndex = -1;
	let errorIssuesIndex = -1;
	if (hasErrorTables && errorDays > 0) {
		errorOccurrenceIndex = statements.length;
		statements.push({
			sql: "DELETE FROM error_occurrences WHERE received_at < ?",
			args: [errorCutoffMs],
		});
		errorUsersIndex = statements.length;
		statements.push({
			sql: `DELETE FROM error_issue_users WHERE issue_id NOT IN (
        SELECT DISTINCT issue_id FROM error_occurrences)`,
			args: [],
		});
		errorActivityIndex = statements.length;
		statements.push({
			sql: `DELETE FROM error_issue_activity WHERE issue_id NOT IN (
        SELECT DISTINCT issue_id FROM error_occurrences)`,
			args: [],
		});
		errorIssuesIndex = statements.length;
		statements.push({
			sql: `DELETE FROM error_issues WHERE id NOT IN (
        SELECT DISTINCT issue_id FROM error_occurrences)`,
			args: [],
		});
	}
	const results = await client.batch(statements, "write");

	return {
		deletedEvents: results[0]?.rowsAffected ?? 0,
		deletedSessions: results[1]?.rowsAffected ?? 0,
		deletedPeople: results[5]?.rowsAffected ?? 0,
		deletedErrorOccurrences:
			errorOccurrenceIndex >= 0
				? (results[errorOccurrenceIndex]?.rowsAffected ?? 0)
				: 0,
		deletedErrorUsers:
			errorUsersIndex >= 0 ? (results[errorUsersIndex]?.rowsAffected ?? 0) : 0,
		deletedErrorActivity:
			errorActivityIndex >= 0
				? (results[errorActivityIndex]?.rowsAffected ?? 0)
				: 0,
		deletedErrorIssues:
			errorIssuesIndex >= 0
				? (results[errorIssuesIndex]?.rowsAffected ?? 0)
				: 0,
	};
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);
	const statusOnly = args.includes("--status");
	const dryRun = args.includes("--dry-run");

	const days = parseRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);
	const errorDays = parseErrorRetentionDays(process.env.ERROR_RETENTION_DAYS);

	const url = process.env.TURSO_DATABASE_URL ?? "";
	if (!url) {
		logger.error("retention", "TURSO_DATABASE_URL is required");
		process.exit(1);
	}
	const authToken = process.env.TURSO_AUTH_TOKEN ?? "";
	const client = createClient({ url, authToken });

	const stats = await retentionStats(client, days, errorDays);

	logger.info(
		"retention",
		"status",
		stats as unknown as Record<string, unknown>,
	);

	if (!stats.enabled) {
		logger.info(
			"retention",
			"disabled — ANALYTICS_RETENTION_DAYS / ERROR_RETENTION_DAYS unset or 0, nothing was deleted",
		);
		process.exit(0);
	}

	if (statusOnly) {
		logger.info("retention", "status only — no deletion performed");
		process.exit(0);
	}

	if (dryRun) {
		logger.info(
			"retention",
			"dry run — would delete expired events, sessions and errors, no deletion performed",
			{
				expiredEvents: stats.events.expired,
				expiredSessions: stats.sessions.expired,
				expiredPeople: stats.people.expired,
				expiredErrorOccurrences: stats.errors.occurrences.expired,
				orphanedErrorIssues: stats.errors.orphanedIssues,
				cutoffMs: retentionCutoffMs(days),
			},
		);
		process.exit(0);
	}

	const result = await applyRetention(client, days, errorDays);
	errorMetrics.record({
		retentionDeletedOccurrences: result.deletedErrorOccurrences,
		retentionDeletedIssues: result.deletedErrorIssues,
	});
	logger.info("retention", "deletion applied", result);
	process.exit(0);
}

// Only run the CLI when executed directly (not when imported by tests).
const isMain =
	(process.argv[1] ?? "").endsWith("retention.ts") ||
	(process.argv[1] ?? "").endsWith("retention.js");
if (isMain) {
	main().catch((error) => {
		logger.error("retention", "failed", {
			message: error instanceof Error ? error.message : error,
		});
		process.exit(1);
	});
}
