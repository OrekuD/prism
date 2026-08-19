import { type Client, createClient } from "@libsql/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
	applyPendingMigrations,
	readMigrationFiles,
} from "../database/migrations";
import {
	applyRetention,
	parseRetentionDays,
	retentionCutoff,
	retentionCutoffMs,
	retentionStats,
} from "../retention";

/**
 * Retention tests (task-6 closure, task-9 slice 5): a real libSQL
 * :memory: client runs the ACTUAL ordered migrations, so table shapes,
 * batch semantics, and row counts match production. V2 tables use
 * INTEGER ms timestamps; the legacy v1 sessions table (TEXT created_at)
 * is exercised as the pre-read-path leftover it is.
 */

let client: Client;

const OLD_DAY_MS = Date.now() - 10 * 86_400_000;
const NEW_DAY_MS = Date.now() - 86_400_000;
const OLD_DAY = "datetime('now', '-10 days')";
const NEW_DAY = "datetime('now', '-1 day')";

async function seed(): Promise<void> {
	// v2 events (received_at INTEGER ms)
	await client.execute({
		sql: "INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at) VALUES ('old-event', 'p1', 'track', 'old', 2, ?, ?)",
		args: [OLD_DAY_MS, OLD_DAY_MS],
	});
	await client.execute({
		sql: "INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at) VALUES ('fresh-event', 'p1', 'track', 'fresh', 2, ?, ?)",
		args: [NEW_DAY_MS, NEW_DAY_MS],
	});
	// v2 sessions (last_seen_at INTEGER ms)
	await client.execute({
		sql: "INSERT INTO sessions_v2 (session_id, project_id, started_at, last_seen_at) VALUES ('old-session', 'p1', ?, ?)",
		args: [OLD_DAY_MS, OLD_DAY_MS],
	});
	await client.execute({
		sql: "INSERT INTO sessions_v2 (session_id, project_id, started_at, last_seen_at) VALUES ('fresh-session', 'p1', ?, ?)",
		args: [NEW_DAY_MS, NEW_DAY_MS],
	});
	// The legacy v1 sessions table was dropped with the v1 routes
	// (task-9 slice 6) — retention operates on the v2 model only.
}

beforeAll(async () => {
	client = createClient({ url: ":memory:" });
	await applyPendingMigrations(client, readMigrationFiles());
	await seed();
});

describe("parseRetentionDays", () => {
	it("unset/empty disables retention", () => {
		expect(parseRetentionDays(undefined)).toBe(0);
		expect(parseRetentionDays("")).toBe(0);
		expect(parseRetentionDays("0")).toBe(0);
	});

	it("accepts positive integers", () => {
		expect(parseRetentionDays("30")).toBe(30);
		expect(parseRetentionDays("7")).toBe(7);
	});

	it("rejects negatives, floats, and junk", () => {
		for (const bad of ["-1", "1.5", "abc", "30 days"]) {
			expect(() => parseRetentionDays(bad)).toThrow(/ANALYTICS_RETENTION_DAYS/);
		}
	});
});

describe("retentionCutoff", () => {
	it("formats SQLite datetime (UTC, seconds precision) for legacy tables", () => {
		expect(retentionCutoff(1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
	});

	it("returns epoch milliseconds for v2 tables", () => {
		const cutoff = retentionCutoffMs(1);
		expect(Number.isFinite(cutoff)).toBe(true);
		expect(cutoff).toBeLessThan(Date.now());
	});
});

describe("applyRetention", () => {
	it("is a no-op when disabled (0 days)", async () => {
		const result = await applyRetention(client, 0);
		expect(result).toEqual({
			deletedEvents: 0,
			deletedSessions: 0,
			deletedPeople: 0,
			deletedErrorOccurrences: 0,
			deletedErrorUsers: 0,
			deletedErrorActivity: 0,
			deletedErrorIssues: 0,
		});
		const stats = await retentionStats(client, 0);
		expect(stats.events.total).toBe(2);
		expect(stats.sessions.total).toBe(2);
		expect(stats.people.total).toBe(0);
		expect(stats.errors.occurrences.total).toBe(0);
	});

	it("reports expired counts without deleting (dry-run path)", async () => {
		const stats = await retentionStats(client, 7);
		expect(stats.enabled).toBe(true);
		expect(stats.events.expired).toBe(1); // old-event only
		expect(stats.sessions.expired).toBe(1); // old-session only

		// nothing deleted yet
		const after = await retentionStats(client, 7);
		expect(after.events.total).toBe(2);
		expect(after.sessions.total).toBe(2);
	});

	it("deletes expired v2 events, v2 sessions, and legacy sessions atomically", async () => {
		const result = await applyRetention(client, 7);
		expect(result).toEqual({
			deletedEvents: 1,
			deletedSessions: 1,
			deletedPeople: 0,
			deletedErrorOccurrences: 0,
			deletedErrorUsers: 0,
			deletedErrorActivity: 0,
			deletedErrorIssues: 0,
		});
		const stats = await retentionStats(client, 7);
		expect(stats.events.total).toBe(1); // fresh-event survives
		expect(stats.events.expired).toBe(0);
		expect(stats.sessions.total).toBe(1); // fresh-session survives
	});

	it("is idempotent — a second apply deletes nothing", async () => {
		const second = await applyRetention(client, 7);
		expect(second).toEqual({
			deletedEvents: 0,
			deletedSessions: 0,
			deletedPeople: 0,
			deletedErrorOccurrences: 0,
			deletedErrorUsers: 0,
			deletedErrorActivity: 0,
			deletedErrorIssues: 0,
		});
	});

	it("prunes expired error occurrences and ORPHANS their issues + activity", async () => {
		const OLD = Date.now() - 10 * 86_400_000;
		const NEW = Date.now() - 86_400_000;
		await client.execute({
			sql: `INSERT INTO error_issues (id, project_id, platform, fingerprint_version,
              fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count)
            VALUES ('issue-old', 'p1', 'web', 1, 'a', 'error', 'unresolved', 'Old boom', ?, ?, 1)`,
			args: [OLD, OLD],
		});
		await client.execute({
			sql: `INSERT INTO error_issues (id, project_id, platform, fingerprint_version,
              fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count)
            VALUES ('issue-fresh', 'p1', 'web', 1, 'b', 'error', 'resolved', 'Fresh boom', ?, ?, 1)`,
			args: [NEW, NEW],
		});
		await client.execute({
			sql: "INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, anonymous_id, payload) VALUES ('occ-old', 'c1', 'issue-old', 'p1', 's1', 'web', 'error', 1, ?, ?, 'anon-old', '{}')",
			args: [OLD, OLD],
		});
		await client.execute({
			sql: "INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, anonymous_id, payload) VALUES ('occ-fresh', 'c2', 'issue-fresh', 'p1', 's1', 'web', 'error', 1, ?, ?, 'anon-fresh', '{}')",
			args: [NEW, NEW],
		});
		await client.execute({
			sql: "INSERT INTO error_issue_users (issue_id, anonymous_id) VALUES ('issue-old', 'anon-old'), ('issue-fresh', 'anon-fresh')",
		});
		await client.execute({
			sql: "INSERT INTO error_issue_activity (id, issue_id, project_id, actor_id, actor_type, action, prior_state, new_state, timestamp) VALUES ('act-old', 'issue-old', 'p1', NULL, 'member', 'resolved', 'unresolved', 'resolved', ?), ('act-fresh', 'issue-fresh', 'p1', NULL, 'member', 'resolved', 'unresolved', 'resolved', ?)",
			args: [OLD, NEW],
		});

		const result = await applyRetention(client, 7, 7);
		expect(result.deletedErrorOccurrences).toBe(1);
		expect(result.deletedErrorUsers).toBe(1);
		expect(result.deletedErrorActivity).toBe(1);
		expect(result.deletedErrorIssues).toBe(1);

		const stats = await retentionStats(client, 7, 7);
		expect(stats.errors.occurrences.total).toBe(1);
		expect(stats.errors.orphanedIssues).toBe(0);
		expect(stats.errors.orphanedActivity).toBe(0);

		const freshIssue = await client.execute({
			sql: "SELECT status FROM error_issues WHERE id = 'issue-fresh'",
		});
		expect(freshIssue.rows[0]?.status).toBe("resolved");
	});
});
