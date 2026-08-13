import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsController } from "../controllers/TeamsController";
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
const OWNER_ID = "22222222-2222-2222-2222-222222222222";
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";
const TEAM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_A = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const PROJECT_B = "cccccccc-cccc-cccc-cccc-cccccccccccc";

function ctxFor(userId: string) {
  return makeCtx({ teamId: TEAM_ID }, {}, { user: { id: userId } });
}

function defaultNeon(projects: Array<{ id: string; slug: string; name: string }>) {
  return makeMockDb((sql) => {
    if (sql.includes("SELECT owner_id FROM teams")) {
      return [{ owner_id: OWNER_ID }];
    }
    if (sql.includes("SELECT id FROM team_members")) {
      return [{ id: "m1" }];
    }
    if (sql.includes("SELECT id, slug, name FROM projects")) {
      return projects;
    }
    return [];
  });
}

function makeTurso(rows: Array<Record<string, unknown>> = []) {
  const execute = vi.fn(
    async (_opts: { sql: string; args: unknown[] }) => ({ rows }),
  );
  getTursoInstance.mockReturnValue({ execute } as never);
  return execute;
}

describe("TeamsController.projects (canonical analytics store)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads session summaries from Turso, not the legacy D1 binding", async () => {
    const neon = defaultNeon([
      { id: PROJECT_A, slug: "alpha", name: "Alpha" },
      { id: PROJECT_B, slug: "beta", name: "Beta" },
    ]);
    getInstance.mockReturnValue(neon as never);
    const turso = makeTurso([
      { project_id: PROJECT_A, day: "2026-08-01", mobile: 1, desktop: 0 },
    ]);

    await TeamsController.projects(ctxFor(USER_ID));

    expect(turso).toHaveBeenCalledTimes(1);
    const call = turso.mock.calls[0]?.[0] as unknown as {
      sql: string;
      args: unknown[];
    };
    // ONE bounded aggregate over all projects, session_started only,
    // 7-day epoch-ms window — never a full session-row load
    expect(String(call.sql)).toMatch(
      /project_id\s+IN\s*\(\s*\?\s*,\s*\?\s*\)/i,
    );
    expect(String(call.sql)).toMatch(/session_started/i);
    expect(String(call.sql)).toMatch(/GROUP BY project_id, day/i);
    expect(call.args).toHaveLength(3);
    expect(call.args[0]).toBe(PROJECT_A);
    expect(call.args[1]).toBe(PROJECT_B);
    const sinceMs = call.args[2] as number;
    expect(sinceMs).toBeGreaterThan(Date.now() - 8 * 86_400_000);
    expect(sinceMs).toBeLessThan(Date.now() - 6 * 86_400_000);
  });

  it("does not build an invalid IN () query for a team without projects", async () => {
    const neon = defaultNeon([]);
    getInstance.mockReturnValue(neon as never);
    const turso = makeTurso();

    const result = await TeamsController.projects(ctxFor(USER_ID));

    expect(turso).not.toHaveBeenCalled();
    expect(result).toMatchObject({ __json: [] });
  });

  it("denies non-members and non-owners", async () => {
    const neon = defaultNeon([{ id: PROJECT_A, slug: "alpha", name: "Alpha" }]);
    getInstance.mockReturnValue(neon as never);
    const turso = makeTurso();

    // The team owner is OWNER_ID; USER_ID is a stranger (no team_members row).
    const strangerNeon = makeMockDb((sql) => {
      if (sql.includes("SELECT owner_id FROM teams")) {
        return [{ owner_id: OWNER_ID }];
      }
      if (sql.includes("SELECT id FROM team_members")) return [];
      if (sql.includes("SELECT id, slug, name FROM projects")) {
        return [{ id: PROJECT_A, slug: "alpha", name: "Alpha" }];
      }
      return [];
    });
    getInstance.mockReturnValue(strangerNeon as never);

    const result = await TeamsController.projects(ctxFor(STRANGER_ID));

    expect(result).toMatchObject({ __json: [] });
    expect(turso).not.toHaveBeenCalled();
  });
});
