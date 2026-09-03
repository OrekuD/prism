import { beforeEach, describe, expect, it, vi } from "vitest";

import { PeopleController } from "../controllers/PeopleController";
import { makeMockDb, makeCtx } from "./helpers";

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
const SLUG = "alpha";
const PERSON_ID = "u_1234567890abcdef";

function ctxFor(
  userId: string | null,
  params: Record<string, string>,
  body?: unknown,
  query: Record<string, string> = {},
) {
  return makeCtx(params, body ?? {}, userId ? { user: { id: userId } } : {}, query);
}

type MockResult = { __json?: unknown; __status?: number };

function statusOf(result: unknown): number | undefined {
  return (result as MockResult).__status;
}

function bodyOf(result: unknown): Record<string, unknown> {
  return ((result as MockResult).__json ?? {}) as Record<string, unknown>;
}

function errorOf(result: unknown): string[] {
  return (
    (bodyOf(result) as { errors?: string[] }).errors ??
    ((bodyOf(result) as { error?: string }).error
      ? [(bodyOf(result) as { error: string }).error]
      : [])
  );
}

/**
 * Mock store shaped like the Task 13 schema: membership lives in the
 * canonical `member` table; projects resolve through their slug.
 */
function makeStore(role: "owner" | "admin" | "member" | null) {
  return makeMockDb((sql) => {
    if (sql.includes("SELECT role FROM member")) {
      return role ? [{ role }] : [];
    }
    if (sql.includes("SELECT id, organization_id, slug FROM projects")) {
      return [{ id: PROJECT_ID, organization_id: ORG_ID, slug: SLUG }];
    }
    if (sql.includes("SELECT id, name, platform FROM project_sources")) {
      return [{ id: "src_web_1", name: "Acme Web", platform: "web" }];
    }
    return [];
  });
}

function makeTurso(
  handler: (sql: string) => { rows: Array<Record<string, unknown>> },
) {
  const execute = vi.fn(async (opts: { sql: string; args?: unknown[] }) =>
    handler(String(opts.sql)),
  );
  getTursoInstance.mockReturnValue({ execute } as never);
  return execute;
}

describe("PeopleController authorization (task-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("a member can read the people list with summary + keyset shape", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    makeTurso((sql) => {
      if (sql.includes("FROM person_traits")) return { rows: [] };
      // the summary subqueries also reference `FROM people p` — match the
      // summary by its select aliases FIRST
      if (sql.includes("identified_people")) {
        return {
          rows: [
            {
              identified_people: 1,
              active_people: 1,
              new_people: 0,
              anonymous_people: 2,
            },
          ],
        };
      }
      if (sql.includes("FROM people p")) {
        return {
          rows: [
            {
              person_id: PERSON_ID,
              first_seen_at: 1,
              last_seen_at: 2,
              primary_external_id: "user-1",
              event_count: 3,
              session_count: 1,
              external_identity_count: 1,
              anonymous_identity_count: 0,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await PeopleController.list(
      ctxFor(USER_ID, { slug: SLUG }),
    );

    expect(statusOf(result) ?? 200).toBe(200);
    const body = bodyOf(result) as {
      people: Array<{ primaryExternalId: string | null }>;
      summary: { identifiedPeople: number; anonymousPeople: number };
      nextCursor: string | null;
    };
    expect(body.people[0]?.primaryExternalId).toBe("user-1");
    expect(body.summary.identifiedPeople).toBe(1);
    expect(body.summary.anonymousPeople).toBe(2);
    expect(body.nextCursor).toBeNull();
  });

  it("a non-member receives a non-disclosing 404", async () => {
    getInstance.mockReturnValue(makeStore(null) as never);
    makeTurso(() => ({ rows: [] }));

    const result = await PeopleController.list(ctxFor(STRANGER_ID, { slug: SLUG }));

    expect(statusOf(result)).toBe(404);
    expect(errorOf(result)).toEqual(["project_not_found"]);
  });

  it("a member receives 403 for export and delete; the API enforces the role", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    makeTurso(() => ({ rows: [] }));

    const exportResult = await PeopleController.export(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(exportResult)).toBe(403);

    const removeResult = await PeopleController.remove(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(removeResult)).toBe(403);
  });

  it("an owner can export; delete requires ?confirm=true and reports the store result", async () => {
    getInstance.mockReturnValue(makeStore("owner") as never);
    const execute = vi.fn(async (opts: { sql: string }) => {
      const sql = String(opts.sql);
      if (sql.includes("FROM people WHERE") && sql.includes("person_id = ?")) {
        return {
          rows: [{ person_id: PERSON_ID, first_seen_at: 1, last_seen_at: 2 }],
        };
      }
      return { rows: [] };
    });
    const batch = vi.fn(async (statements: Array<{ sql: string }>) =>
      statements.map((statement) => ({
        rows: [],
        rowsAffected: statement.sql.includes("DELETE FROM people") ? 1 : 0,
      })),
    );
    getTursoInstance.mockReturnValue({ execute, batch } as never);

    const exportResult = await PeopleController.export(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(exportResult) ?? 200).toBe(200);
    expect(
      execute.mock.calls.some(([opts]) =>
        String((opts as { sql: string }).sql).includes("FROM people WHERE"),
      ),
    ).toBe(true);

    const unconfirmed = await PeopleController.remove(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(unconfirmed)).toBe(400);
    expect(errorOf(unconfirmed)).toEqual(["confirmation_required"]);
    expect(batch).not.toHaveBeenCalled();

    // confirmed owner deletion: the batch ran, and the response carries the
    // store's `deleted` result for THIS person id
    const confirmed = await PeopleController.remove(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }, {}, { confirm: "true" }),
    );
    expect(statusOf(confirmed) ?? 200).toBe(200);
    expect(bodyOf(confirmed)).toMatchObject({ deleted: true, personId: PERSON_ID });
    expect(batch).toHaveBeenCalledTimes(1);
    const batchStatements = batch.mock.calls[0]?.[0] as Array<{ sql: string }>;
    expect(
      batchStatements.some((statement) =>
        statement.sql.includes("DELETE FROM people"),
      ),
    ).toBe(true);
  });
});

describe("PeopleController activity attribution (task-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("hydrates trusted source attribution and Standard Event metadata", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const occurredAt = Date.now();
    makeTurso((sql) => {
      if (sql.includes("FROM people WHERE") && sql.includes("LIMIT 1")) {
        return { rows: [{ 1: 1 }] };
      }
      if (sql.includes("FROM events") && sql.includes("person_id = ?")) {
        return {
          rows: [
            {
              id: "evt-std-1",
              session_id: "sess-1",
              project_id: PROJECT_ID,
              name: "$prism_sign_up",
              type: "track",
              properties: JSON.stringify({
                $standard: { schemaVersion: 1, key: "sign_up", data: { method: "email" } },
              }),
              context: null,
              occurred_at: occurredAt,
              received_at: occurredAt,
              schema_version: 3,
              anonymous_id: "anon-1",
              user_id: "user-1",
              person_id: PERSON_ID,
              source_id: "src_web_1",
              platform: "web",
              sdk_name: "@prism-analytics/browser",
              sdk_version: "0.0.4",
            },
            {
              id: "evt-custom-1",
              session_id: null,
              project_id: PROJECT_ID,
              name: "checkout_completed",
              type: "track",
              properties: null,
              context: null,
              occurred_at: occurredAt,
              received_at: occurredAt,
              schema_version: 3,
              anonymous_id: null,
              user_id: null,
              person_id: PERSON_ID,
              source_id: null,
              platform: null,
              sdk_name: null,
              sdk_version: null,
            },
          ],
        };
      }
      return { rows: [] };
    });

    const result = await PeopleController.activity(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );

    expect(statusOf(result) ?? 200).toBe(200);
    const events = bodyOf(result) as unknown as Array<{
      id: string;
      source: { name: string; platform: string; status: string } | null;
      standardEvent: { key: string; displayName: string } | null;
    }>;
    expect(events).toHaveLength(2);
    // trusted source hydration, project-scoped (the mock store only serves
    // THIS project's sources)
    expect(events[0]?.source).toEqual({
      id: "src_web_1",
      name: "Acme Web",
      platform: "web",
      status: "active",
    });
    // Standard Event display metadata derived from the stored name+schema
    expect(events[0]?.standardEvent).toMatchObject({
      key: "sign_up",
      displayName: "Sign up",
    });
    // custom events stay null-attributed
    expect(events[1]?.standardEvent).toBeNull();
    expect(events[1]?.source).toBeNull();
  });

  it("clamps the activity limit to the documented bounded range", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const execute = makeTurso((sql) => {
      if (sql.includes("FROM people WHERE") && sql.includes("LIMIT 1")) {
        return { rows: [{ 1: 1 }] };
      }
      return { rows: [] };
    });

    await PeopleController.activity(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID, limit: "99999" }),
    );

    const activityCall = execute.mock.calls.find(([opts]) =>
      String((opts as { sql: string }).sql).includes("FROM events"),
    );
    const args = (activityCall?.[0] as { args?: unknown[] }).args ?? [];
    expect(args[args.length - 2]).toBe(200);
  });
});

describe("PeopleController range handling (task-20)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it.each([
    ["7d", 7],
    ["30d", 30],
    ["90d", 90],
  ])("applies the exact %s window to both list and summary queries", async (range, days) => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const now = 1_785_542_400_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const from = now - days * 86_400_000;
    const to = now;
    const execute = makeTurso(() => ({ rows: [] }));

    await PeopleController.list(ctxFor(USER_ID, { slug: SLUG }, {}, { range }));

    // the summary query carries the exact [from, to] window
    const summaryCall = execute.mock.calls.find(([opts]) =>
      String((opts as { sql: string }).sql).includes("anonymous_people"),
    );
    expect(summaryCall).toBeDefined();
    const summaryArgs = (summaryCall?.[0] as { args?: unknown[] }).args ?? [];
    const numbers = summaryArgs.filter(
      (arg) => typeof arg === "number",
    ) as number[];
    expect(numbers).toContain(from);
    expect(numbers).toContain(to);

    // the list query receives the same range for its last_seen_at clause
    const listCall = execute.mock.calls.find(
      ([opts]) =>
        String((opts as { sql: string }).sql).includes("FROM people p") &&
        !String((opts as { sql: string }).sql).includes("identified_people"),
    );
    expect(listCall).toBeDefined();
    const listSql = String((listCall?.[0] as { sql: string }).sql);
    expect(listSql).toContain("p.last_seen_at >= ?");
    const listArgs = (listCall?.[0] as { args?: unknown[] }).args ?? [];
    expect(listArgs).toContain(from);
    vi.restoreAllMocks();
  });

  it("defaults an unknown range to 30d", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const now = 1_785_542_400_000;
    vi.spyOn(Date, "now").mockReturnValue(now);
    const execute = makeTurso(() => ({ rows: [] }));

    await PeopleController.list(
      ctxFor(USER_ID, { slug: SLUG }, {}, { range: "bogus" }),
    );

    const summaryCall = execute.mock.calls.find(([opts]) =>
      String((opts as { sql: string }).sql).includes("anonymous_people"),
    );
    const summaryArgs = (summaryCall?.[0] as { args?: unknown[] }).args ?? [];
    expect(summaryArgs).toContain(now - 30 * 86_400_000);
    expect(summaryArgs).toContain(now);
    vi.restoreAllMocks();
  });
});

describe("PeopleController pagination inputs (review R1-F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clamps fractional, NaN, and oversized limits to a bounded integer", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const execute = makeTurso(() => ({ rows: [] }));

    for (const [raw, expected] of [
      ["2.5", 50],
      ["abc", 50],
      ["999", 50],
      ["0", 50],
      ["-4", 50],
      ["25", 25],
    ] as Array<[string, number]>) {
      execute.mockClear();
      await PeopleController.list(ctxFor(USER_ID, { slug: SLUG }, {}, { limit: raw }));
      const listCall = execute.mock.calls.find(([opts]) =>
        String((opts as { sql: string }).sql).includes("LIMIT ?"),
      );
      const args = (listCall?.[0] as { args?: unknown[] }).args ?? [];
      expect(args[args.length - 1], `limit=${raw}`).toBe(expected + 1);
    }
  });

  it("rejects malformed cursors with a structured 400 and accepts round trips", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    makeTurso(() => ({ rows: [] }));

    for (const bad of ["abc", "a:b:c", "not-even-base64!!"]) {
      const result = await PeopleController.list(
        ctxFor(USER_ID, { slug: SLUG }, {}, { cursor: bad }),
      );
      expect(statusOf(result), `cursor=${bad}`).toBe(400);
      expect(errorOf(result)).toEqual(["invalid_cursor"]);
    }

    // a valid opaque cursor passes the boundary and reaches the store
    const valid = Buffer.from(
      JSON.stringify([1_785_542_400_000, "u_abc"]),
    ).toString("base64url");
    const ok = await PeopleController.list(
      ctxFor(USER_ID, { slug: SLUG }, {}, { cursor: valid }),
    );
    expect(statusOf(ok) ?? 200).toBe(200);
  });
});
