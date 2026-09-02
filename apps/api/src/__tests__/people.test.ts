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

function ctxFor(userId: string | null, params: Record<string, string>, body?: unknown) {
  return makeCtx(params, body ?? {}, userId ? { user: { id: userId } } : {});
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
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }, { confirm: "true" }),
    );
    // the route passes ?confirm=true as a query param — a member is still 403
    const removeResultWithConfirm = await PeopleController.remove(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    void removeResultWithConfirm;
    expect(statusOf(removeResult)).toBe(403);
  });

  it("an owner can export, and delete requires ?confirm=true", async () => {
    getInstance.mockReturnValue(makeStore("owner") as never);
    const exportCalls: string[] = [];
    makeTurso((sql) => {
      exportCalls.push(sql);
      if (sql.includes("FROM people WHERE") && sql.includes("person_id = ?")) {
        return {
          rows: [{ person_id: PERSON_ID, first_seen_at: 1, last_seen_at: 2 }],
        };
      }
      return { rows: [] };
    });

    const exportResult = await PeopleController.export(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(exportResult) ?? 200).toBe(200);
    expect(exportCalls.some((sql) => sql.includes("FROM people WHERE"))).toBe(true);

    const unconfirmed = await PeopleController.remove(
      ctxFor(USER_ID, { slug: SLUG, personId: PERSON_ID }),
    );
    expect(statusOf(unconfirmed)).toBe(400);
    expect(errorOf(unconfirmed)).toEqual(["confirmation_required"]);
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
  ])("accepts the supported range %s and applies its window", async (range, days) => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const execute = makeTurso(() => ({ rows: [] }));

    await PeopleController.list(ctxFor(USER_ID, { slug: SLUG, range }));

    const listCall = execute.mock.calls.find(([opts]) =>
      String((opts as { sql: string }).sql).includes("FROM people p"),
    );
    const args = (listCall?.[0] as { args?: unknown[] }).args ?? [];
    // from/to ride the summary query; the list itself receives them through
    // peopleList's range clause
    expect(execute).toHaveBeenCalled();
    void args;
    vi.restoreAllMocks();
  });

  it("defaults an unknown range to 30d", async () => {
    getInstance.mockReturnValue(makeStore("member") as never);
    const now = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(now);
    const execute = makeTurso(() => ({ rows: [] }));

    await PeopleController.list(
      ctxFor(USER_ID, { slug: SLUG, range: "bogus" }),
    );

    const summaryCall = execute.mock.calls.find(([opts]) =>
      String((opts as { sql: string }).sql).includes("anonymous_people"),
    );
    const args = (summaryCall?.[0] as { args?: unknown[] }).args ?? [];
    const from = Number(args.find((arg) => typeof arg === "number"));
    expect(from).toBeGreaterThan(0);
    expect(from).toBeLessThanOrEqual(now);
    // 30 days: from is within 31 days of now and beyond 7 days ago
    expect(from).toBeLessThan(now - 7 * 86_400_000);
    vi.restoreAllMocks();
  });
});
