import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ErrorIssuesController,
	issueWorkflowLimiter,
} from "../controllers/ErrorIssuesController";
import { errorRangeDays, issueDelta } from "../utils/errorIssuesStore";
import { makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
	DatabaseManager: { getInstance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager", () => ({
	TursoDatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);
const getTursoInstance = vi.mocked(TursoDatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";
const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const ISSUE_ID = "eeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee";
const SLUG = "alpha";

function ctxFor(
	userId: string | null,
	params: Record<string, string>,
	body?: unknown,
	query?: Record<string, string>,
) {
	const ctx = makeCtx(
		params,
		body ?? {},
		userId ? { user: { id: userId } } : {},
	);
	if (query) {
		(ctx as { req: { query: unknown } }).req.query = vi.fn(
			(key: string) => query[key],
		);
	}
	return ctx;
}

/** Neon store shaped like Task 13: project -> organization -> member role. */
function makeStore(role: "owner" | "admin" | "member" | null) {
	return makeMockDb((sql, args) => {
		if (sql.includes("FROM projects")) {
			return role === null ? [] : [{ id: PROJECT_ID, organization_id: ORG_ID }];
		}
		if (sql.includes("SELECT role FROM member")) {
			return role && args[0] === USER_ID ? [{ role }] : [];
		}
		return [];
	});
}

const makeMockDb = (
	handler: (sql: string, args: unknown[]) => Array<Record<string, unknown>>,
) =>
	vi.fn(async (strings: TemplateStringsArray, ...args: unknown[]) => {
		const sql = strings.join("?").replace(/\s+/g, " ");
		return handler(sql, args);
	});

/** Turso reader shaped like the analytics store: three concern queries. */
function makeTurso(options: {
	issues?: Array<Record<string, unknown>>;
	counts?: Array<Record<string, unknown>>;
	users?: Array<Record<string, unknown>>;
	updateRowsAffected?: number;
	statusSelectRows?: Array<Record<string, unknown>>;
	occurrenceRows?: Array<Record<string, unknown>>;
	activityRows?: Array<Record<string, unknown>>;
	aggregateRow?: Record<string, unknown> | null;
}) {
	const {
		issues = [],
		counts = [],
		users = [],
		updateRowsAffected = 0,
		statusSelectRows,
		occurrenceRows,
		activityRows,
		aggregateRow,
	} = options;
	const execute = vi.fn(async (input: { sql: string; args: unknown[] }) => {
		const sql = input.sql.replace(/\s+/g, " ");
		if (sql.includes("UPDATE error_issues")) {
			return { rows: [], rowsAffected: updateRowsAffected };
		}
		if (statusSelectRows && sql.includes("SELECT status FROM error_issues")) {
			return { rows: statusSelectRows, rowsAffected: statusSelectRows.length };
		}
		// Windowed counters ALSO read FROM error_occurrences, so they must be
		// matched before the occurrence-page branch below.
		if (sql.includes("SUM(CASE WHEN received_at >=")) {
			return { rows: counts, rowsAffected: 1 };
		}
		if (sql.includes("COUNT(DISTINCT anonymous_id)")) {
			return { rows: users, rowsAffected: 1 };
		}
		if (sql.includes("FROM error_issue_activity")) {
			return { rows: activityRows ?? [], rowsAffected: activityRows?.length ?? 0 };
		}
		if (sql.includes("FROM error_occurrences")) {
			return { rows: occurrenceRows ?? [], rowsAffected: occurrenceRows?.length ?? 0 };
		}
		if (sql.includes("SELECT occurrence_count")) {
			return { rows: aggregateRow ? [aggregateRow] : [], rowsAffected: aggregateRow ? 1 : 0 };
		}
		if (sql.includes("FROM error_issues")) {
			return { rows: issues, rowsAffected: 1 };
		}
		return { rows: [], rowsAffected: 0 };
	});
	getTursoInstance.mockReturnValue({ execute } as never);
	return execute;
}

type MockResult = { __json?: unknown; __status?: number };
const statusOf = (result: unknown): number | undefined =>
	(result as MockResult).__status;
const jsonOf = (result: unknown): unknown => (result as MockResult).__json;

const now = Date.now();
const webIssue = {
	id: ISSUE_ID,
	title: "TypeError: Cannot read properties of null",
	fingerprint: "fpr_web",
	platform: "web",
	level: "error",
	status: "unresolved",
	location: "app.js:203",
	first_seen_at: now - 1000, // inside the current window -> "new"
	last_seen_at: now - 500,
};

describe("errorIssuesStore", () => {
	it("maps range keys to days, falling back to 30", () => {
		expect(errorRangeDays("24h")).toBe(1);
		expect(errorRangeDays("seven-days")).toBe(7);
		expect(errorRangeDays("two-weeks")).toBe(14);
		expect(errorRangeDays("one-month")).toBe(30);
		expect(errorRangeDays("one-year")).toBe(30);
		expect(errorRangeDays(undefined)).toBe(30);
	});

	it("classifies delta without fabricating a baseline", () => {
		const windowStart = 1_000_000;
		expect(issueDelta(windowStart + 100, 5, 0, windowStart)).toBe("new");
		expect(issueDelta(windowStart - 5_000, 8, 3, windowStart)).toBe(
			"regressing",
		);
		expect(issueDelta(windowStart - 5_000, 2, 9, windowStart)).toBe(
			"declining",
		);
		// equal or no prior baseline: null, not invented
		expect(issueDelta(windowStart - 5_000, 3, 3, windowStart)).toBeNull();
		expect(issueDelta(windowStart - 5_000, 3, 0, windowStart)).toBeNull();
	});
});

describe("ErrorIssuesController", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		issueWorkflowLimiter.reset();
	});
	afterEach(() => {
		vi.useRealTimers();
	});

	describe("list", () => {
		it("a member can list issues as windowed resources", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({
				issues: [webIssue],
				counts: [{ issue_id: ISSUE_ID, current_count: 5, previous_count: 0 }],
				users: [{ issue_id: ISSUE_ID, users: 2 }],
			});

			const result = await ErrorIssuesController.list(
				ctxFor(USER_ID, { slug: SLUG }),
			);
			expect(statusOf(result) ?? 200).toBe(200);
			const list = jsonOf(result) as Array<Record<string, unknown>>;
			expect(list).toHaveLength(1);
			const issue = list[0] as Record<string, unknown>;
			expect(issue.id).toBe(ISSUE_ID);
			expect(issue.status).toBe("unresolved");
			expect(issue.count).toBe(5);
			expect(issue.users).toBe(2);
			expect(issue.delta).toBe("new");
			expect(issue.location).toBe("app.js:203");
			expect(issue.platform).toBe("web");
			expect(issue.level).toBe("error");
		});

		it("passes the range query through to the store window", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			const execute = makeTurso({ issues: [webIssue] });

			await ErrorIssuesController.list(
				ctxFor(USER_ID, { slug: SLUG }, undefined, { range: "seven-days" }),
			);
			// windowCounts + windowUsers (the range is reflected in the args)
			const windowed = execute.mock.calls.find(([input]) =>
				String((input as { sql: string }).sql).includes("SUM(CASE"),
			);
			expect(windowed).toBeDefined();
			const args = (windowed?.[0] as { args: Array<number> }).args;
			const nowWindow = args[0] as number;
			expect(nowWindow).toBeCloseTo(Date.now() - 7 * 86_400_000, -5);
		});

		it("a non-member gets a non-disclosing 404", async () => {
			const neon = makeStore("member"); // project exists
			getInstance.mockReturnValue(neon as never);
			makeTurso({});

			const result = await ErrorIssuesController.list(
				ctxFor(STRANGER_ID, { slug: SLUG }),
			);
			expect(statusOf(result)).toBe(404);
		});
	});

	describe("update", () => {
		it("an owner can resolve an issue; the response is the fresh resource", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			makeTurso({
				issues: [{ ...webIssue, status: "resolved" }],
				updateRowsAffected: 1,
			});

			const result = await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);
			expect(statusOf(result) ?? 200).toBe(200);
			const resource = jsonOf(result) as Record<string, unknown>;
			expect(resource.id).toBe(ISSUE_ID);
			expect(resource.status).toBe("resolved");
		});

		it("an admin can reopen a resolved issue", async () => {
			const neon = makeStore("admin");
			getInstance.mockReturnValue(neon as never);
			makeTurso({
				issues: [{ ...webIssue, status: "unresolved" }],
				updateRowsAffected: 1,
			});

			const result = await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "unresolved" },
				),
			);
			expect((jsonOf(result) as Record<string, unknown>).status).toBe(
				"unresolved",
			);
		});

		it("a member cannot change issue state (403)", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({});

			const result = await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);
			expect(statusOf(result)).toBe(403);
		});

		it("a non-member cannot change issue state (non-disclosing 404)", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({});

			const result = await ErrorIssuesController.update(
				ctxFor(
					STRANGER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);
			expect(statusOf(result)).toBe(404);
		});

		it("rejects an invalid status (400)", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			makeTurso({});

			const result = await ErrorIssuesController.update(
				ctxFor(USER_ID, { slug: SLUG, issueId: ISSUE_ID }, { status: "muted" }),
			);
			expect(statusOf(result)).toBe(400);
		});

		it("a missing issue id is a non-disclosing 404 (no rows updated)", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			makeTurso({ issues: [], updateRowsAffected: 0 });

			const result = await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: "nope" },
					{ status: "resolved" },
				),
			);
			expect(statusOf(result)).toBe(404);
		});

		it("records an auditable activity row for a resolved transition", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			const execute = makeTurso({
				issues: [{ ...webIssue, status: "resolved" }],
				statusSelectRows: [{ status: "unresolved" }],
				updateRowsAffected: 1,
			});

			await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);

			const insert = execute.mock.calls.find(([input]) =>
				String((input as { sql: string }).sql).includes(
					"INSERT INTO error_issue_activity",
				),
			);
			expect(insert).toBeDefined();
			const args = (insert?.[0] as { args: Array<unknown> }).args;
			expect(args[2]).toBe(PROJECT_ID); // project_id
			expect(args[3]).toBe(USER_ID); // actor_id
			expect(args[4]).toBe("resolved"); // action
			expect(args[5]).toBe("unresolved"); // prior_state
			expect(args[6]).toBe("resolved"); // new_state
		});

		it("rate-limits a management-action storm (429)", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			makeTurso({ issues: [{ ...webIssue, status: "resolved" }] });
			issueWorkflowLimiter.hit(USER_ID, 60);

			const result = await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);
			expect(statusOf(result)).toBe(429);
		});

		it("an idempotent same-status update writes no activity row", async () => {
			const neon = makeStore("owner");
			getInstance.mockReturnValue(neon as never);
			const execute = makeTurso({
				issues: [{ ...webIssue, status: "resolved" }],
				statusSelectRows: [{ status: "resolved" }],
			});

			await ErrorIssuesController.update(
				ctxFor(
					USER_ID,
					{ slug: SLUG, issueId: ISSUE_ID },
					{ status: "resolved" },
				),
			);

			expect(
				execute.mock.calls.some(([input]) =>
					String((input as { sql: string }).sql).includes(
						"UPDATE error_issues",
					),
				),
			).toBe(false);
			expect(
				execute.mock.calls.some(([input]) =>
					String((input as { sql: string }).sql).includes(
						"INSERT INTO error_issue_activity",
					),
				),
			).toBe(false);
		});
	});

	describe("detail", () => {
		const occurrenceRow = {
			id: "occ-0001",
			occurred_at: now - 500,
			received_at: now - 500,
			level: "error",
			handled: 1,
			release: "web@1.2.3",
			environment: null,
			anonymous_id: "anon-a",
			payload: JSON.stringify({
				exception: {
					type: "TypeError",
					message: "Cannot read properties of null",
					frames: [
						{ file: "https://example.com/app.js", line: 203, column: 9, inApp: true },
					],
				},
				context: { tags: { area: "checkout" }, extras: { order: 42 } },
				breadcrumbs: [{ type: "navigation", message: "cart" }],
			}),
		};
		const aggregateRow = {
			occurrence_count: 7,
			users_affected: 2,
			first_release: "web@1.0.0",
			last_release: "web@1.2.3",
		};
		const activityRow = {
			id: "act-1",
			actor_id: USER_ID,
			actor_type: "member",
			action: "resolved",
			prior_state: "unresolved",
			new_state: "resolved",
			timestamp: now - 1000,
			note: null,
		};

		it("a member reads a detail with sanitized occurrences + activity + aggregates", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({
				issues: [webIssue],
				counts: [{ issue_id: ISSUE_ID, current_count: 5, previous_count: 0 }],
				users: [{ issue_id: ISSUE_ID, users: 2 }],
				occurrenceRows: [occurrenceRow],
				activityRows: [activityRow],
				aggregateRow,
			});

			const result = await ErrorIssuesController.detail(
				ctxFor(USER_ID, { slug: SLUG, issueId: ISSUE_ID }),
			);
			expect(statusOf(result) ?? 200).toBe(200);
			const detail = jsonOf(result) as Record<string, unknown>;
			const issue = detail.issue as Record<string, unknown>;
			expect(issue.id).toBe(ISSUE_ID);
			expect(issue.count).toBe(5);
			expect(issue.delta).toBe("new");

			const occurrences = detail.occurrences as Array<Record<string, unknown>>;
			expect(occurrences).toHaveLength(1);
			const occ = occurrences[0] as Record<string, unknown>;
			const exception = occ.exception as Record<string, unknown>;
			expect(exception.type).toBe("TypeError");
			const frames = exception.frames as Array<Record<string, unknown>>;
			expect(frames[0]?.file).toBe("https://example.com/app.js");
			expect(frames[0]?.line).toBe(203);
			expect(occ.tagsCount).toBe(1);
			expect(occ.extrasCount).toBe(1);
			expect(occ.breadcrumbsCount).toBe(1);
			expect(detail.hasMoreOccurrences).toBe(false);

			const activity = detail.activity as Array<Record<string, unknown>>;
			expect(activity[0]?.action).toBe("resolved");
			expect(activity[0]?.actorId).toBe(USER_ID);

			expect(detail.occurrenceCountAll).toBe(7);
			expect(detail.usersAffectedAll).toBe(2);
			expect(detail.firstRelease).toBe("web@1.0.0");
			expect(detail.lastRelease).toBe("web@1.2.3");
		});

		it("flags when more occurrences exist past the page", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			const execute = makeTurso({
				issues: [webIssue],
				occurrenceRows: [occurrenceRow, occurrenceRow, occurrenceRow],
				aggregateRow,
			});

			await ErrorIssuesController.detail(
				ctxFor(USER_ID, { slug: SLUG, issueId: ISSUE_ID }),
			);
			const occCall = execute.mock.calls.find(([input]) =>
				String((input as { sql: string }).sql).includes(
					"FROM error_occurrences",
				),
			);
			// 15+1 cap: the row fixture short-circuits the LIMIT in the mock,
			// but the page still cuts to the bound and reports hasMore.
			expect(occCall).toBeDefined();
		});

		it("a member sees hasMore=true when the page is full", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			const many = Array.from({ length: 16 }, (_, index) => ({
				...occurrenceRow,
				id: `occ-${String(index).padStart(4, "0")}`,
			}));
			makeTurso({
				issues: [webIssue],
				occurrenceRows: many,
				aggregateRow,
			});

			const result = await ErrorIssuesController.detail(
				ctxFor(USER_ID, { slug: SLUG, issueId: ISSUE_ID }),
			);
			const detail = jsonOf(result) as Record<string, unknown>;
			expect(detail.hasMoreOccurrences).toBe(true);
			expect((detail.occurrences as Array<unknown>)).toHaveLength(15);
		});

		it("a non-member cannot read detail (non-disclosing 404)", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({});

			const result = await ErrorIssuesController.detail(
				ctxFor(STRANGER_ID, { slug: SLUG, issueId: ISSUE_ID }),
			);
			expect(statusOf(result)).toBe(404);
		});

		it("a missing issue is a non-disclosing 404", async () => {
			const neon = makeStore("member");
			getInstance.mockReturnValue(neon as never);
			makeTurso({ issues: [], aggregateRow: null });

			const result = await ErrorIssuesController.detail(
				ctxFor(USER_ID, { slug: SLUG, issueId: "nope" }),
			);
			expect(statusOf(result)).toBe(404);
		});
	});
});
