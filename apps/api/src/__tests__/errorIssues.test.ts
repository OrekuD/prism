import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ErrorIssuesController } from "../controllers/ErrorIssuesController";
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
}) {
	const {
		issues = [],
		counts = [],
		users = [],
		updateRowsAffected = 0,
	} = options;
	const execute = vi.fn(async (input: { sql: string; args: unknown[] }) => {
		const sql = input.sql.replace(/\s+/g, " ");
		if (sql.includes("UPDATE error_issues")) {
			return { rows: [], rowsAffected: updateRowsAffected };
		}
		if (sql.includes("COUNT(DISTINCT anonymous_id)")) {
			return { rows: users, rowsAffected: 1 };
		}
		if (sql.includes("SUM(CASE WHEN received_at >=")) {
			return { rows: counts, rowsAffected: 1 };
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
	});
});
