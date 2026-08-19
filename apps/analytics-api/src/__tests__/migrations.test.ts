import { type Client, createClient } from "@libsql/client";
import { beforeAll, describe, expect, it } from "vitest";
import {
	type Migration,
	applyPendingMigrations,
	ensureJournal,
	readMigrationFiles,
} from "../database/migrations";
import {
	isApprovedResetTarget,
	resetStore,
	targetIdentity,
} from "../database/reset";

/**
 * Migration + reset tests (task-9 slice 5): a REAL libSQL :memory: store
 * runs the ACTUAL migration files — journal semantics, atomicity, plan
 * verification on representative data, and the guarded reset policy all
 * run in every CI (no env-gating).
 */

let client: Client;

beforeAll(async () => {
	client = createClient({ url: ":memory:" });
});

describe("migration runner", () => {
	it("applies every ordered migration exactly once with a journal", async () => {
		const migrations = readMigrationFiles();
		expect(migrations.length).toBeGreaterThanOrEqual(3);
		expect(migrations.map((m) => m.version)).toEqual(
			[...migrations.map((m) => m.version)].sort((a, b) => a - b),
		);

		const applied = await applyPendingMigrations(client, migrations);
		expect(applied).toHaveLength(migrations.length);

		const { rows } = await client.execute(
			"SELECT version, name FROM schema_migrations ORDER BY version",
		);
		expect(rows.map((r) => Number(r.version))).toEqual(
			migrations.map((m) => m.version),
		);
		// the schema is real: v2 tables + indexes exist
		const tables = await client.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
		);
		const names = tables.rows.map((r) => String(r.name));
		expect(names).toContain("events");
		expect(names).toContain("sessions_v2");
		expect(names).toContain("schema_migrations");
		expect(names).toContain("error_issues"); // task-15 slice 1
		expect(names).toContain("error_occurrences");
		expect(names).toContain("error_issue_users");
		expect(names).not.toContain("events_v2"); // interim dropped
	});

	it("is idempotent — a second run applies nothing", async () => {
		const again = await applyPendingMigrations(client, readMigrationFiles());
		expect(again).toHaveLength(0);
	});

	it("applies only pending migrations when new ones appear later", async () => {
		const fresh = createClient({ url: ":memory:" });
		const synthetic: Migration[] = [
			{
				version: 1,
				name: "001_first.sql",
				sql: "CREATE TABLE t1 (id INTEGER)",
			},
		];
		await applyPendingMigrations(fresh, synthetic);
		const later: Migration[] = [
			...synthetic,
			{
				version: 2,
				name: "002_second.sql",
				sql: "CREATE TABLE t2 (id INTEGER)",
			},
		];
		const applied = await applyPendingMigrations(fresh, later);
		expect(applied.map((m) => m.version)).toEqual([2]);
		const tables = await fresh.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('t1','t2') ORDER BY name",
		);
		expect(tables.rows).toHaveLength(2);
		fresh.close();
	});

	it("rolls back a failing migration atomically (no partial schema, no journal row)", async () => {
		const fresh = createClient({ url: ":memory:" });
		const failing: Migration[] = [
			{
				version: 1,
				name: "001_bad.sql",
				sql: "CREATE TABLE partial_ok (id INTEGER); CREATE TABLE partial_broken (id INTEGER); THIS IS NOT SQL",
			},
		];
		await expect(applyPendingMigrations(fresh, failing)).rejects.toThrow();

		const tables = await fresh.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table'",
		);
		const names = tables.rows.map((r) => String(r.name));
		expect(names).not.toContain("partial_ok");
		expect(names).not.toContain("partial_broken");
		const journal = await fresh.execute(
			"SELECT COUNT(*) AS n FROM schema_migrations",
		);
		expect(Number(journal.rows[0]?.n)).toBe(0);
		fresh.close();
	});

	it("fails loudly on a legacy v1 `events` table instead of serving the wrong shape", async () => {
		const legacy = createClient({ url: ":memory:" });
		await legacy.execute(
			"CREATE TABLE events (id INTEGER PRIMARY KEY, session_id TEXT, project_id TEXT, name TEXT, data TEXT, created_at DATETIME)",
		);
		await expect(
			applyPendingMigrations(legacy, readMigrationFiles()),
		).rejects.toThrow(/SQLITE_ERROR|already exists/);
		// nothing was journaled — the legacy store stays untouched
		const journal = await legacy.execute(
			"SELECT COUNT(*) AS n FROM schema_migrations",
		);
		expect(Number(journal.rows[0]?.n)).toBe(0);
		legacy.close();
	});

	it("verifies query plans use the justified indexes on representative data", async () => {
		// representative rows across projects/names/sessions
		const now = Date.now();
		const rows = [];
		for (let i = 0; i < 40; i += 1) {
			rows.push(
				`('ev-${i}', 'p1', 'track', 'page_viewed', 2, ${now - i}, ${now - i}, 'sess-1', 'anon-1', '{}', '{}', '@prism-analytics/core', '0.0.1')`,
			);
		}
		for (let i = 0; i < 10; i += 1) {
			rows.push(
				`('ev-other-${i}', 'p2', 'track', 'signup', 2, ${now}, ${now}, 'sess-2', 'anon-2', '{}', '{}', '@prism-analytics/core', '0.0.1')`,
			);
		}
		await client.execute(
			`INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at, session_id, anonymous_id, properties, context, sdk_name, sdk_version) VALUES ${rows.join(",")}`,
		);

		const plans = await Promise.all([
			client.execute(
				"EXPLAIN QUERY PLAN SELECT * FROM events WHERE project_id = 'p1' AND occurred_at > 0",
			),
			client.execute(
				"EXPLAIN QUERY PLAN SELECT * FROM events WHERE project_id = 'p1' AND name = 'page_viewed' AND occurred_at > 0",
			),
			client.execute(
				"EXPLAIN QUERY PLAN SELECT * FROM events WHERE session_id = 'sess-1'",
			),
			client.execute(
				"EXPLAIN QUERY PLAN SELECT * FROM events WHERE anonymous_id = 'anon-1'",
			),
		]);
		for (const plan of plans) {
			const detail = JSON.stringify(plan.rows);
			expect(detail).toMatch(/USING (COVERING )?INDEX/i);
		}
	});
});

describe("guarded reset", () => {
	it("resolves a non-secret target identity", () => {
		expect(targetIdentity("file:analytics.db")).toBe("file:analytics.db");
		expect(targetIdentity("http://127.0.0.1:5001")).toBe("127.0.0.1:5001");
		expect(targetIdentity("http://sqld:5001")).toBe("sqld:5001");
		expect(targetIdentity("libsql://hosted.turso.io")).toBe(
			"hosted.turso.io:default",
		);
	});

	it("approves only file: and loopback targets", () => {
		expect(isApprovedResetTarget("file:analytics.db")).toBe(true);
		expect(isApprovedResetTarget("http://localhost:5001")).toBe(true);
		expect(isApprovedResetTarget("http://127.0.0.1:5001")).toBe(true);
		expect(isApprovedResetTarget("http://[::1]:5001")).toBe(true);
		// refused: hosted Turso, internal compose hosts, junk
		expect(isApprovedResetTarget("libsql://hosted.turso.io")).toBe(false);
		expect(isApprovedResetTarget("http://sqld:5001")).toBe(false);
		expect(isApprovedResetTarget("not a url")).toBe(false);
	});

	it("drops every analytics table + journal in one atomic batch", async () => {
		const store = createClient({ url: ":memory:" });
		await applyPendingMigrations(store, readMigrationFiles());
		await resetStore(store);

		const tables = await store.execute(
			"SELECT name FROM sqlite_master WHERE type = 'table'",
		);
		// sqlite_sequence is SQLite's internal AUTOINCREMENT bookkeeping — the
		// point is that NO analytics table (or the journal) remains.
		const names = tables.rows
			.map((r) => String(r.name))
			.filter((name) => name !== "sqlite_sequence");
		expect(names).toEqual([]);
		// and migrations can be re-applied from scratch
		const applied = await applyPendingMigrations(store, readMigrationFiles());
		expect(applied.length).toBeGreaterThanOrEqual(3);
		store.close();
	});

	it("creates the journal on demand", async () => {
		const store = createClient({ url: ":memory:" });
		await ensureJournal(store);
		const { rows } = await store.execute(
			"SELECT COUNT(*) AS n FROM schema_migrations",
		);
		expect(Number(rows[0]?.n)).toBe(0);
		store.close();
	});
});

describe("pinned reset target (release review 4)", () => {
	it("refuses hosted targets unless the EXACT url is pinned", () => {
		process.env.ANALYTICS_RESET_TARGET = "";
		expect(isApprovedResetTarget("libsql://hosted.turso.io")).toBe(false);

		process.env.ANALYTICS_RESET_TARGET = "libsql://hosted.turso.io";
		expect(isApprovedResetTarget("libsql://hosted.turso.io")).toBe(true);
		// a DIFFERENT configured url is still refused — the pin is exact
		expect(isApprovedResetTarget("libsql://other.turso.io")).toBe(false);

		process.env.ANALYTICS_RESET_TARGET = "";
		expect(isApprovedResetTarget("libsql://hosted.turso.io")).toBe(false);
	});
});
