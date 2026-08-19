import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	ErrorIngestController,
	errorLimiter,
} from "../controllers/ErrorIngestController.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
	default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
	default: {
		instance: { execute: vi.fn(), batch: vi.fn(), transaction: vi.fn() },
	},
}));
vi.mock("../managers/WebSocketManager.js", () => ({
	default: { emitToClient: vi.fn(() => true) },
}));

import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";

/** Occurrence ids that simulate an already-stored client event id. */
const DUPLICATE_CLIENT_IDS = new Set(["evt_dup"]);

const txExecute = vi.fn(
	async (statement: { sql?: string; args?: unknown[] }) => {
		const sql = String(statement?.sql ?? "");
		const args = statement?.args ?? [];
		if (sql.includes("INSERT INTO error_occurrences")) {
			const clientEventId = String(args[1] ?? "");
			return {
				rows: [],
				rowsAffected: DUPLICATE_CLIENT_IDS.has(clientEventId) ? 0 : 1,
			};
		}
		// issue upserts and user tracking always apply
		return { rows: [], rowsAffected: 1 };
	},
);
const tx = {
	execute: txExecute,
	batch: vi.fn(async () => [{ rows: [], rowsAffected: 1 }]),
	commit: vi.fn(async () => undefined),
	rollback: vi.fn(async () => undefined),
};
(
	TursoDatabaseManager.instance.transaction as unknown as ReturnType<
		typeof vi.fn
	>
).mockResolvedValue(tx);

const executedStatements = () =>
	txExecute.mock.calls.map(
		(call) => call[0] as { sql: string; args: unknown[] },
	);

function statementContaining(fragment: string) {
	return executedStatements().find((statement) =>
		String(statement.sql).includes(fragment),
	);
}

const PROJECT = {
	projectId: "p-00000000-0000-0000-0000-000000000001",
	sourceId: "s-00000000-0000-0000-0000-000000000001",
	platform: "web",
	keyType: "publishable",
};

function streamOf(body: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

function makeCtx(body: string, auth: Partial<typeof PROJECT> = PROJECT) {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === "content-type"
					? "application/json"
					: String(body.length),
			raw: { body: streamOf(body) },
		},
		header: vi.fn(),
		json: (value: unknown, status?: number) => ({ __json: value, status }),
		get: (name: string) => auth[name as keyof typeof auth] ?? "",
	} as never;
}

const validItem = (id = "evt_1") => ({
	id,
	occurredAt: Date.now(),
	level: "error",
	handled: false,
	exception: {
		type: "TypeError",
		message: "boom",
		frames: [
			{ file: "https://app.example.com/app.js", function: "f", line: 1 },
		],
	},
	context: { extras: { password: "hunter2" } },
});

const envelope = (errors: unknown[]) =>
	JSON.stringify({ schemaVersion: 1, sentAt: Date.now(), errors });

beforeEach(() => {
	vi.clearAllMocks();
	txExecute.mockClear();
	errorLimiter.reset();
});

describe("ErrorIngestController.ingest", () => {
	it("accepts a valid batch and persists occurrence + issue in one transaction", async () => {
		const response = (await ErrorIngestController.ingest(
			makeCtx(envelope([validItem()])),
		)) as unknown as {
			__json: { ok: boolean; results: Array<{ status: string }> };
		};

		expect(response.__json.ok).toBe(true);
		expect(response.__json.results).toEqual([
			{ index: 0, id: "evt_1", status: "accepted" },
		]);
		expect(tx.commit).toHaveBeenCalled();
		expect(statementContaining("INSERT INTO error_occurrences")).toBeDefined();
		expect(statementContaining("INSERT INTO error_issues")).toBeDefined();
	});

	it("persists the sanitized payload (credentials redacted)", async () => {
		await ErrorIngestController.ingest(makeCtx(envelope([validItem()])));

		const insert = statementContaining("INSERT INTO error_occurrences");
		const payload = JSON.parse(String(insert?.args?.[13])) as {
			context: { extras: Record<string, unknown> };
		};
		expect(payload.context.extras.password).toBe("[REDACTED]");
	});

	it("rejects invalid items with coarse reasons, preserving order", async () => {
		const response = (await ErrorIngestController.ingest(
			makeCtx(
				envelope([validItem(), { id: "evt_2", occurredAt: "nope" }, "junk"]),
			),
		)) as unknown as {
			__json: { results: Array<{ status: string; reason?: string }> };
		};

		expect(response.__json.results).toEqual([
			{ index: 0, id: "evt_1", status: "accepted" },
			{
				index: 1,
				id: "evt_2",
				status: "rejected",
				reason: "invalid-timestamp",
			},
			{ index: 2, id: "", status: "rejected", reason: "invalid-payload" },
		]);
		// only the valid item reaches the store
		expect(statementContaining("INSERT INTO error_occurrences")).toBeDefined();
		expect(
			executedStatements().filter((s) =>
				s.sql.includes("INSERT INTO error_occurrences"),
			),
		).toHaveLength(1);
	});

	it("marks retried client event ids as duplicates without issue updates", async () => {
		const response = (await ErrorIngestController.ingest(
			makeCtx(envelope([validItem("evt_dup")])),
		)) as unknown as { __json: { results: Array<{ duplicate?: boolean }> } };

		expect(response.__json.results[0]?.duplicate).toBe(true);
		// duplicate delivery never touches the issue row
		expect(statementContaining("INSERT INTO error_issues")).toBeUndefined();
	});

	it("rejects a server source authenticated with a publishable key (401)", async () => {
		const response = (await ErrorIngestController.ingest(
			makeCtx(envelope([validItem()]), {
				projectId: PROJECT.projectId,
				sourceId: PROJECT.sourceId,
				platform: "server",
				keyType: "publishable",
			}),
		)) as unknown as { status?: number; __json: { error: { code: string } } };

		expect((response.__json as { errors?: string[] }).errors).toContain(
			"unauthorized",
		);
		expect(
			statementContaining("INSERT INTO error_occurrences"),
		).toBeUndefined();
	});

	it("rejects oversized requests before reading the body (413)", async () => {
		const big = "x".repeat(300 * 1024);
		const response = (await ErrorIngestController.ingest(
			makeCtx(JSON.stringify({ schemaVersion: 1, errors: [{ note: big }] })),
		)) as unknown as { __json: { error: { code: string } } };

		expect(response.__json.error.code).toBe("too-large");
	});

	it("rejects malformed envelopes (400)", async () => {
		const response = (await ErrorIngestController.ingest(
			makeCtx("not-json"),
		)) as unknown as { __json: { error: { code: string } } };

		expect(response.__json.error.code).toBe("invalid-envelope");
	});

	it("returns 429 when the per-project quota is exhausted", async () => {
		// exhaust the exact quota (only allowed hits are recorded)
		errorLimiter.hit(PROJECT.projectId, 1000);
		const response = (await ErrorIngestController.ingest(
			makeCtx(envelope([validItem()])),
		)) as unknown as { __json: { error: { code: string } } };

		expect(response.__json.error.code).toBe("rate-limited");
	});
});
