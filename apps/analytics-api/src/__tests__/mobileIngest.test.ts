import { type Client, createClient } from "@libsql/client";
import { afterAll, beforeAll, afterEach, describe, expect, it } from "vitest";
import {
	applyPendingMigrations,
	ensureJournal,
	readMigrationFiles,
} from "../database/migrations";
import TursoDatabaseManager from "../managers/TursoDatabaseManager";
import { IngestController } from "../controllers/IngestController";

/**
 * Focused REAL-store mobile ingestion tests (R3-F1/R3-F2/R3-F6): every
 * migration runs against a libSQL :memory: store, then the ACTUAL
 * IngestController ingests mobile reserved records through the same code
 * path production uses. Proves commit/rollback/partitioning behavior that
 * string-presence gates cannot see.
 */

// Isolated FILE store configured BEFORE the manager is touched, so
// production code and tests share ONE libSQL connection (an env-less
// createClient({url:""}) would open a second, schema-less database).
const DB_URL = `file:/tmp/prism-mobile-ingest-${process.pid}-${Date.now()}.db`;
process.env.TURSO_DATABASE_URL = DB_URL;
delete process.env.TURSO_AUTH_TOKEN;

let client: Client;
const PROJECT_ID = "mob-project-00000000-0000-0000-0000-000000000000";
const SOURCE_ID = "mob-source-00000000-0000-0000-0000-000000000001";
const SALT = "test-installation-salt";

beforeAll(async () => {
	client = TursoDatabaseManager.instance;
	await ensureJournal(client);
	await applyPendingMigrations(client, readMigrationFiles());
	process.env.ANALYTICS_INSTALLATION_SALT = SALT;
});

afterEach(async () => {
	await client.batch([
		{ sql: "DELETE FROM mobile_screen_views WHERE project_id = ?", args: [PROJECT_ID] },
		{ sql: "DELETE FROM mobile_app_sessions WHERE project_id = ?", args: [PROJECT_ID] },
		{ sql: "DELETE FROM mobile_installations WHERE project_id = ?", args: [PROJECT_ID] },
		{ sql: "DELETE FROM events WHERE project_id = ?", args: [PROJECT_ID] },
	], "write");
});

afterAll(async () => {
	client.close();
}, 10_000);

function streamOf(body: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

function makeCtx(body: string) {
	const store = new Map<string, string>([
		["projectId", PROJECT_ID],
		["platform", "react-native"],
		["sourceId", SOURCE_ID],
	]);
	return {
		req: {
			header: (name: string) => {
				const n = name.toLowerCase();
				if (n === "content-type") return "application/json";
				if (n === "content-length") return String(body.length);
				if (n === "user-agent") return "PrismMobile/1.0";
				return undefined;
			},
			raw: { body: streamOf(body) },
		},
		header: () => undefined,
		json: (value: unknown, status?: number) => ({ __json: value, status }),
		get: (key: string) => store.get(key) ?? "",
		env: {},
	} as never;
}

interface EnvelopeEvent {
	schemaVersion: number;
	eventId: string;
	type: "track";
	occurredAt: number;
	sessionId?: string;
	name?: string;
	properties?: Record<string, unknown>;
	context?: Record<string, unknown>;
}

function envelope(events: EnvelopeEvent[]): string {
	return JSON.stringify({
		schemaVersion: 2,
		sentAt: Date.now(),
		sdk: { name: "@prism-analytics/react-native", version: "0.0.1" },
		events,
	});
}

function screenEvent(
	eventId: string,
	now: number,
	sessionId: string,
	sequence: number,
	extraProps: Record<string, unknown> = {},
): EnvelopeEvent {
	return {
		schemaVersion: 2,
		eventId,
		type: "track",
		occurredAt: now,
		sessionId,
		name: "$prism_screen_view",
		context: { os: "ios", osVersion: "17.4" },
		properties: {
			$screen: { name: "Home", navigation: "push", sequence },
			$app: { version: "1.2.3", build: "42", environment: "production" },
			$installation: "install-abc-123",
			...extraProps,
		},
	};
}

describe("mobile ingestion real store", () => {
	it("commits a valid react-native screen event AND its projection atomically", async () => {
		const now = Date.now();
		const res = await IngestController.ingest(
			makeCtx(
				envelope([
					screenEvent("mob-ev-1", now, "sess-a", 1),
					{
						schemaVersion: 2,
						eventId: "mob-ev-lc-1",
						type: "track",
						occurredAt: now + 1000,
						sessionId: "sess-a",
						name: "$prism_app_lifecycle",
						properties: {
							$lifecycle: { transition: "background", sequence: 2, durationMs: 4500 },
						},
					},
				]),
			),
		);
		expect(res.status).toBe(200);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const body = (res as any).__json as {
			results: Array<{ status: string; reason?: string }>;
		};
		expect(body.results.every((r) => r.status === "accepted")).toBe(true);

		const eventRow = await client.execute({
			sql: "SELECT session_sequence FROM events WHERE project_id = ? AND id = ?",
			args: [PROJECT_ID, "mob-ev-1"],
		});
		expect(eventRow.rows).toHaveLength(1);

		const projection = await client.execute({
			sql: "SELECT source_id, screen_name, app_version, os, installation_digest FROM mobile_screen_views WHERE project_id = ? AND event_id = ?",
			args: [PROJECT_ID, "mob-ev-1"],
		});
		expect(projection.rows).toHaveLength(1);
		const row = projection.rows[0] as Record<string, unknown>;
		expect(row.source_id).toBe(SOURCE_ID); // R3-F1: NOT NULL satisfied
		expect(row.screen_name).toBe("Home");
		expect(row.app_version).toBe("1.2.3");
		expect(row.os).toBe("ios");
		expect(String(row.installation_digest)).toMatch(/^[a-f0-9]{32}$/);
		// RAW installation id must not persist anywhere in the row.
		expect(JSON.stringify(row)).not.toContain("install-abc-123");
		const propsRow = await client.execute({
			sql: "SELECT properties FROM events WHERE project_id = ? AND id = ?",
			args: [PROJECT_ID, "mob-ev-1"],
		});
		expect(JSON.stringify(propsRow.rows[0])).not.toContain("install-abc-123");

		const session = await client.execute({
			sql: "SELECT screen_count, foreground_active_ms FROM mobile_app_sessions WHERE project_id = ? AND session_id = ?",
			args: [PROJECT_ID, "sess-a"],
		});
		expect(session.rows).toHaveLength(1);
		expect(Number((session.rows[0] as Record<string, unknown>).screen_count)).toBe(1);
		expect(Number((session.rows[0] as Record<string, unknown>).foreground_active_ms)).toBe(4500);

		const installation = await client.execute({
			sql: "SELECT installation_digest FROM mobile_installations WHERE project_id = ?",
			args: [PROJECT_ID],
		});
		expect(installation.rows).toHaveLength(1);
	});

	it("partitions mixed batches: rejected reserved rows store NOTHING; valid rows keep their projections", async () => {
		const now = Date.now();
		const res = await IngestController.ingest(
			makeCtx(
				envelope([
					// structurally invalid generic event
					{ schemaVersion: 2, eventId: "mob-bad-generic", type: "track", occurredAt: now, name: "" } as EnvelopeEvent,
					// malformed reserved (sequence 0)
					{
						schemaVersion: 2, eventId: "mob-bad-screen", type: "track", occurredAt: now,
						sessionId: "sess-b", name: "$prism_screen_view",
						properties: { $screen: { name: "X", navigation: "manual", sequence: 0 } },
					},
					// valid screen AFTER an invalid one (compaction ordering)
					screenEvent("mob-good-screen", now, "sess-b", 1),
					// valid custom event
					{ schemaVersion: 2, eventId: "mob-custom", type: "track", occurredAt: now, sessionId: "sess-b", name: "custom_thing", properties: { n: 1 } },
				]),
			),
		);
		expect(res.status).toBe(200);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const body = (res as any).__json as {
			results: Array<{ id: string; status: string; reason?: string }>;
		};
		const byId = new Map(body.results.map((r) => [r.id, r]));
		// submitted-order statuses survive the compacted persistence pass
		expect(byId.get("mob-bad-screen")?.status).toBe("rejected");
		expect(byId.get("mob-bad-screen")?.reason).toBe("invalid-mobile-screen");
		expect(byId.get("mob-good-screen")?.status).toBe("accepted");

		for (const rejectedId of ["mob-bad-generic", "mob-bad-screen"]) {
			const stored = await client.execute({
				sql: "SELECT id FROM events WHERE project_id = ? AND id = ?",
				args: [PROJECT_ID, rejectedId],
			});
			expect(stored.rows).toHaveLength(0); // zero rows for every rejection
		}
		const goodProjection = await client.execute({
			sql: "SELECT event_id FROM mobile_screen_views WHERE project_id = ? AND event_id = ?",
			args: [PROJECT_ID, "mob-good-screen"],
		});
		expect(goodProjection.rows).toHaveLength(1); // compaction did not orphan it
		const custom = await client.execute({
			sql: "SELECT id FROM events WHERE project_id = ? AND id = ?",
			args: [PROJECT_ID, "mob-custom"],
		});
		expect(custom.rows).toHaveLength(1);
	});

	it("duplicate delivery does not increment projections or aggregates", async () => {
		const now = Date.now();
		const body = envelope([screenEvent("mob-dup-1", now, "sess-c", 1)]);
		const first = await IngestController.ingest(makeCtx(body));
		expect(first.status).toBe(200);
		const second = await IngestController.ingest(makeCtx(body));
		expect(second.status).toBe(200);
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const secondBody = (second as any).__json as {
			results: Array<{ status: string }>;
		};
		expect(secondBody.results[0].status).toBe("duplicate");

		const projections = await client.execute({
			sql: "SELECT COUNT(*) AS n FROM mobile_screen_views WHERE project_id = ? AND event_id = ?",
			args: [PROJECT_ID, "mob-dup-1"],
		});
		expect(Number(projections.rows[0]?.n)).toBe(1);
		const session = await client.execute({
			sql: "SELECT screen_count FROM mobile_app_sessions WHERE project_id = ? AND session_id = ?",
			args: [PROJECT_ID, "sess-c"],
		});
		expect(Number((session.rows[0] as Record<string, unknown>).screen_count)).toBe(1);
	});
});
