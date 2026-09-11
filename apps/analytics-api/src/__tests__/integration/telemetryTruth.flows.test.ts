/**
 * Task 22 slice 2 — telemetry truth journey through the real SDK and the
 * real ingestion boundary.
 *
 * OPT-IN: hits the real analytics store (TURSO_DATABASE_URL / TURSO_AUTH_TOKEN)
 * and is SKIPPED unless PRISM_RUN_INTEGRATION=1. Never point this at a shared
 * development or production database; use an isolated store.
 *
 * The journey is SDK -> controller -> repository -> store. No final read
 * tables are seeded directly. Rows created here are deleted in afterAll.
 */
import "../testEnv.js";
import { createClient, type Client } from "@libsql/client";
import { config } from "dotenv";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	INTERNAL_SEAM,
	PAGE_VIEW_EVENT_NAME,
	type PrismClient,
	type PrismErrorReporter,
	type PrismResponse,
	type PrismRuntimeAdapter,
	type PrismTransport,
	createPrismClient,
	createPrismErrorReporter,
	errorToException,
} from "@prism-analytics/core";
import { ErrorIngestController } from "../../controllers/ErrorIngestController.js";
import { IngestController } from "../../controllers/IngestController.js";

config({ path: ".env" });

const enabled =
	process.env.PRISM_RUN_INTEGRATION === "1" && !!process.env.TURSO_DATABASE_URL;
const run = enabled ? describe : describe.skip;

const PROJECT_ID = "itest-truth-project-0000-0000-0000-000000000001";
const OTHER_PROJECT_ID = "itest-truth-other-0000-0000-0000-000000000002";
const SOURCE_ID = "itest-truth-source-0000-0000-0000-000000000001";
const SOURCE_KEY = "pr_0123456789abcdef0123456789abcdef";
const ENDPOINT = "http://ingest.itest";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function streamOf(body: string): ReadableStream<Uint8Array> {
	return new ReadableStream({
		start(controller) {
			controller.enqueue(new TextEncoder().encode(body));
			controller.close();
		},
	});
}

function controllerCtx(body: string, projectId = PROJECT_ID) {
	return {
		req: {
			header: (name: string) =>
				name.toLowerCase() === "content-type"
					? "application/json"
					: String(body.length),
			raw: { body: streamOf(body) },
		},
		header: () => undefined,
		json: (value: unknown, status?: number) => ({ __json: value, status }),
		get: (name: string) =>
			({
				projectId,
				sourceId: SOURCE_ID,
				platform: "web",
				keyType: "publishable",
			})[name] ?? "",
	} as never;
}

type DeliveryState = {
	offline?: boolean;
	failures?: number;
	duplicateOnce?: boolean;
	analyticsDeliveries: number[];
	errorDeliveries: number[];
};

/** Transport that delivers into the real controllers; nothing is mocked. */
function makeTransport(state: DeliveryState): PrismTransport {
	return {
		async post(url, request): Promise<PrismResponse> {
			if (state.offline) {
				throw new Error("itest network offline");
			}
			const isError = url.includes("/errors/ingest");
			const dispatch = async () =>
				isError
					? ErrorIngestController.ingest(controllerCtx(request.body))
					: IngestController.ingest(controllerCtx(request.body));
			if ((state.failures ?? 0) > 0) {
				state.failures = (state.failures ?? 0) - 1;
				return {
					status: 429,
					headers: {
						"content-type": "application/json",
						"retry-after": "0",
					},
					text: async () => JSON.stringify({ error: "itest-rate-limited" }),
				};
			}
			const outcome = (await dispatch()) as unknown as {
				__json?: unknown;
				status?: number;
			};
			if (state.duplicateOnce) {
				state.duplicateOnce = false;
				await dispatch();
			}
			if (isError) state.errorDeliveries.push(Date.now());
			else state.analyticsDeliveries.push(Date.now());
			return {
				status: outcome.status ?? 200,
				headers: { "content-type": "application/json" },
				text: async () => JSON.stringify(outcome.__json ?? {}),
			};
		},
	};
}

function memoryStorage(
	store: Map<string, string>,
): NonNullable<PrismRuntimeAdapter["storage"]> {
	return {
		getItem: async (key) => store.get(key) ?? null,
		setItem: async (key, value) => {
			store.set(key, value);
		},
		removeItem: async (key) => {
			store.delete(key);
		},
	};
}

function makeRuntime(options: {
	transport: PrismTransport;
	storage?: Map<string, string>;
	now?: () => number;
}): PrismRuntimeAdapter {
	return {
		name: "task22-truth-fake",
		now: options.now ?? (() => Date.now()),
		createId: () => globalThis.crypto.randomUUID(),
		transport: options.transport,
		storage: options.storage ? memoryStorage(options.storage) : undefined,
		schedule: (delayMs, callback) => {
			const handle = setTimeout(callback, delayMs);
			return () => clearTimeout(handle);
		},
		context: { platform: "web", kind: "web", timezone: "UTC" },
	};
}

async function makeClient(options: {
	transport: PrismTransport;
	storage?: Map<string, string>;
	now?: () => number;
}): Promise<PrismClient> {
	return createPrismClient({
		sourceKey: SOURCE_KEY,
		endpoint: ENDPOINT,
		runtime: makeRuntime(options),
		collection: { initialState: "granted", anonymousPersistence: "session" },
		queue: { flushIntervalMs: 60_000, requestTimeoutMs: 2_000 },
	});
}

function makeReporter(
	client: PrismClient,
	transport: PrismTransport,
): Promise<PrismErrorReporter> {
	return createPrismErrorReporter({
		sourceKey: SOURCE_KEY,
		endpoint: ENDPOINT,
		runtime: makeRuntime({ transport }),
		share: {
			consent: () => client.collectionState,
			anonymousId: () => client.identity.anonymousId,
			sessionId: () => client.session?.sessionId ?? null,
			userId: () => client.identity.userId,
		},
		queue: { flushIntervalMs: 60_000, requestTimeoutMs: 2_000 },
	});
}

let db: Client | null = null;
function store(): Client {
	if (!db) {
		db = createClient({
			url: process.env.TURSO_DATABASE_URL ?? "",
			authToken: process.env.TURSO_AUTH_TOKEN ?? "",
		});
	}
	return db;
}

const CLEANUP_TABLES = [
	"error_occurrences",
	"error_issue_activity",
	"error_issues",
	"web_page_views",
	"sessions_v2",
	"identity_ops",
	"person_traits",
	"anonymous_identities",
	"external_identities",
	"people",
	"events",
] as const;

async function cleanup(): Promise<void> {
	const client = store();
	await client.execute({
		sql: `DELETE FROM error_issue_users WHERE issue_id IN (
			SELECT id FROM error_issues WHERE project_id IN (?, ?))`,
		args: [PROJECT_ID, OTHER_PROJECT_ID],
	});
	for (const table of CLEANUP_TABLES) {
		await client.execute({
			sql: `DELETE FROM ${table} WHERE project_id IN (?, ?)`,
			args: [PROJECT_ID, OTHER_PROJECT_ID],
		});
	}
}

async function eventsNamed(name: string): Promise<Array<Record<string, unknown>>> {
	const result = await store().execute({
		sql: "SELECT * FROM events WHERE project_id = ? AND name = ? ORDER BY received_at, rowid",
		args: [PROJECT_ID, name],
	});
	return result.rows as unknown as Array<Record<string, unknown>>;
}

async function waitFor<T>(
	check: () => Promise<T | null>,
	timeoutMs = 5_000,
): Promise<T> {
	const started = Date.now();
	for (;;) {
		const value = await check();
		if (value !== null) return value;
		if (Date.now() - started > timeoutMs) {
			throw new Error("waitFor timed out");
		}
		await sleep(150);
	}
}

run("telemetry truth journey (task 22 slice 2)", () => {
	beforeAll(async () => {
		if (enabled) await cleanup();
	});
	afterAll(async () => {
		if (enabled) await cleanup();
		db?.close();
	});

	it("attributes anonymous -> identified -> Standard Event -> reset -> second user", async () => {
		const client = await makeClient({
			transport: makeTransport({ analyticsDeliveries: [], errorDeliveries: [] }),
		});
		try {
			const session = client.startSession();
			expect(session.status).toBe("started");
			const firstAnonymous = client.identity.anonymousId;

			client.track("itest_signup_page_viewed", { surface: "hero" });
			client.track("itest_signup_started", { method: "email" });

			const identified = await client.identify("itest-user-one", {
				plan: "trial",
			});
			expect(identified.status).toBe("queued");

			const standard = client.events.signUp({ method: "email" });
			expect(standard.status).toBe("queued");
			client.track("itest_custom_checkout", { value: 42 });

			await client.flush();

			const anonymousRow = (await eventsNamed("itest_signup_page_viewed"))[0];
			expect(anonymousRow?.user_id).toBeNull();
			expect(anonymousRow?.anonymous_id).toBe(firstAnonymous);
			expect(anonymousRow?.source_id).toBe(SOURCE_ID);
			expect(anonymousRow?.platform).toBe("web");

			const standardRow = (await eventsNamed("$prism_sign_up"))[0];
			expect(standardRow?.user_id).toBe("itest-user-one");
			expect(standardRow?.person_id).toBeTruthy();

			const customRow = (await eventsNamed("itest_custom_checkout"))[0];
			expect(customRow?.user_id).toBe("itest-user-one");

			const link = await store().execute({
				sql: "SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = ?",
				args: [PROJECT_ID, "itest-user-one"],
			});
			expect(link.rows.length).toBe(1);
			const personOne = String(link.rows[0]?.person_id);
			expect(personOne.startsWith("u_")).toBe(true);

			const anonLink = await store().execute({
				sql: "SELECT person_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id = ?",
				args: [PROJECT_ID, firstAnonymous],
			});
			expect(anonLink.rows[0]?.person_id).toBe(personOne);

			const reset = await client.reset();
			expect(reset.status).toBe("ok");
			expect(client.identity.anonymousId).not.toBe(firstAnonymous);

			client.track("itest_post_reset_view");
			await client.flush();
			const postReset = (await eventsNamed("itest_post_reset_view"))[0];
			expect(postReset?.anonymous_id).not.toBe(firstAnonymous);
			expect(postReset?.user_id).toBeNull();

			await client.identify("itest-user-two", { plan: "free" });
			client.track("itest_second_user_event");
			await client.flush();

			const secondRow = (await eventsNamed("itest_second_user_event"))[0];
			expect(secondRow?.user_id).toBe("itest-user-two");
			const linkTwo = await store().execute({
				sql: "SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = ?",
				args: [PROJECT_ID, "itest-user-two"],
			});
			expect(linkTwo.rows.length).toBe(1);
			expect(String(linkTwo.rows[0]?.person_id)).not.toBe(personOne);
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("deduplicates a delivered-twice batch to one row per event", async () => {
		const state: DeliveryState = {
			duplicateOnce: true,
			analyticsDeliveries: [],
			errorDeliveries: [],
		};
		const client = await makeClient({ transport: makeTransport(state) });
		try {
			client.track("itest_duplicate_case", { attempt: 1 });
			await client.flush();
			const rows = await eventsNamed("itest_duplicate_case");
			expect(rows.length).toBe(1);
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("recovers an offline queue in occurrence order", async () => {
		const state: DeliveryState = {
			offline: true,
			analyticsDeliveries: [],
			errorDeliveries: [],
		};
		const client = await makeClient({ transport: makeTransport(state) });
		try {
			client.track("itest_offline_first");
			await client.flush().catch(() => undefined);
			expect((await eventsNamed("itest_offline_first")).length).toBe(0);

			await sleep(20);
			client.track("itest_offline_second");
			state.offline = false;

			const delivered = await waitFor(async () => {
				await client.flush().catch(() => undefined);
				const [first, second] = await Promise.all([
					eventsNamed("itest_offline_first"),
					eventsNamed("itest_offline_second"),
				]);
				return first.length === 1 && second.length === 1
					? { first, second }
					: null;
			});
			expect(Number(delivered.first[0]?.occurred_at)).toBeGreaterThan(0);
			expect(Number(delivered.second[0]?.occurred_at)).toBeGreaterThan(
				Number(delivered.first[0]?.occurred_at),
			);
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("drops queued events on consent withdrawal and starts clean on re-grant", async () => {
		const client = await makeClient({
			transport: makeTransport({ analyticsDeliveries: [], errorDeliveries: [] }),
		});
		try {
			client.track("itest_before_withdrawal");
			const originalAnonymous = client.identity.anonymousId;
			expect(originalAnonymous.length).toBeGreaterThan(0);
			await client.setCollectionState("denied");

			const denied = client.track("itest_after_withdrawal");
			expect(denied.status).toBe("dropped");
			await client.flush().catch(() => undefined);
			expect((await eventsNamed("itest_before_withdrawal")).length).toBe(0);
			expect((await eventsNamed("itest_after_withdrawal")).length).toBe(0);

			await client.setCollectionState("granted");
			client.track("itest_after_regrant");
			await client.flush();
			const rows = await eventsNamed("itest_after_regrant");
			expect(rows.length).toBe(1);
			expect(String(rows[0]?.anonymous_id).length).toBeGreaterThan(0);
			expect(rows[0]?.anonymous_id).not.toBe(originalAnonymous);
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("retries a rate-limited batch without losing or duplicating it", async () => {
		const state: DeliveryState = {
			failures: 1,
			analyticsDeliveries: [],
			errorDeliveries: [],
		};
		const client = await makeClient({ transport: makeTransport(state) });
		try {
			client.track("itest_retry_case");
			await client.flush().catch(() => undefined);
			await waitFor(async () => {
				const rows = await eventsNamed("itest_retry_case");
				return rows.length === 1 ? rows : null;
			});
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("captures a JS error into a grouped issue through the real reporter", async () => {
		const state: DeliveryState = { analyticsDeliveries: [], errorDeliveries: [] };
		const transport = makeTransport(state);
		const client = await makeClient({ transport });
		const reporter = await makeReporter(client, transport);
		try {
			const captured = reporter.captureException({
				exception: errorToException(new Error("itest task22 boom")),
				level: "error",
				handled: true,
				context: { tags: { journey: "task22" } },
			});
			expect(captured.status).toBe("queued");
			await reporter.flush();

			const issue = await waitFor(async () => {
				const result = await store().execute({
					sql: "SELECT id, title, occurrence_count FROM error_issues WHERE project_id = ?",
					args: [PROJECT_ID],
				});
				return result.rows.length === 1
					? (result.rows[0] as unknown as Record<string, unknown>)
					: null;
			});
			expect(String(issue?.title)).toContain("itest task22 boom");
			expect(Number(issue?.occurrence_count)).toBe(1);

			const occurrences = await store().execute({
				sql: "SELECT count(*) AS n FROM error_occurrences WHERE project_id = ? AND source_id = ?",
				args: [PROJECT_ID, SOURCE_ID],
			});
			expect(Number(occurrences.rows[0]?.n)).toBe(1);
		} finally {
			await reporter.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("receives batches out of occurrence order without corrupting canonical reads", async () => {
		// Both clocks sit inside the accepted past window; the later event is
		// received first, so receipt order is the reverse of occurrence order.
		const earlyClock = Date.now() - 120_000;
		const early = await makeClient({
			transport: makeTransport({ analyticsDeliveries: [], errorDeliveries: [] }),
			now: () => earlyClock,
		});
		const late = await makeClient({
			transport: makeTransport({ analyticsDeliveries: [], errorDeliveries: [] }),
			now: () => earlyClock + 10_000,
		});
		try {
			late.track("itest_order_late");
			await late.flush(); // received first, occurred later
			await sleep(5);
			early.track("itest_order_early");
			await early.flush(); // received second, occurred earlier

			const [earlyRows, lateRows] = await Promise.all([
				eventsNamed("itest_order_early"),
				eventsNamed("itest_order_late"),
			]);
			expect(earlyRows.length).toBe(1);
			expect(lateRows.length).toBe(1);
			expect(Number(lateRows[0]?.received_at)).toBeLessThan(
				Number(earlyRows[0]?.received_at),
			);
			expect(Number(earlyRows[0]?.occurred_at)).toBeLessThan(
				Number(lateRows[0]?.occurred_at),
			);

			const ordered = await store().execute({
				sql: "SELECT name FROM events WHERE project_id = ? AND name IN (?, ?) ORDER BY occurred_at ASC",
				args: [PROJECT_ID, "itest_order_early", "itest_order_late"],
			});
			expect(ordered.rows[0]?.name).toBe("itest_order_early");
		} finally {
			await early.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
			await late.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});

	it("projects a page view into the web read model", async () => {
		const client = await makeClient({
			transport: makeTransport({ analyticsDeliveries: [], errorDeliveries: [] }),
		});
		try {
			const seam = (
				client as unknown as Record<
					symbol,
					{
						createReservedEvent: (
							name: string,
							properties?: Record<string, unknown>,
						) => { status: string };
					}
				>
			)[INTERNAL_SEAM];
			expect(seam).toBeTruthy();
			const captured = seam?.createReservedEvent(PAGE_VIEW_EVENT_NAME, {
				$page: {
					host: "itest.example.com",
					path: "/pricing",
					navigation: "initial",
					sequence: 1,
					title: "Pricing",
				},
				$referrer: { host: "search.example" },
			});
			expect(captured?.status).toBe("queued");
			await client.flush();

			const rows = await store().execute({
				sql: "SELECT host, path, referrer_host FROM web_page_views WHERE project_id = ?",
				args: [PROJECT_ID],
			});
			expect(rows.rows.length).toBe(1);
			expect(rows.rows[0]?.host).toBe("itest.example.com");
			expect(rows.rows[0]?.path).toBe("/pricing");
			expect(rows.rows[0]?.referrer_host).toBe("search.example");
		} finally {
			await client.shutdown({ timeoutMs: 1_000 }).catch(() => undefined);
		}
	});
});
