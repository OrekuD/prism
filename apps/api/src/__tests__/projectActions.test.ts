import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectsController } from "../controllers/ProjectsController";
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
const TEAM_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function ctxFor(params: Record<string, string>, body?: unknown) {
  return makeCtx(params, body ?? {}, { user: { id: USER_ID } });
}

describe("ProjectsController.renameProject", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renames the project when the caller has admin permission", async () => {
    const neon = makeMockDb((sql, args) => {
      if (sql.includes("SELECT id, team_id FROM projects")) {
        return [{ id: PROJECT_ID, team_id: TEAM_ID }];
      }
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_ID, owner_id: OWNER_ID }];
      }
      if (sql.includes("SELECT permission_id FROM team_members")) {
        return [{ permission_id: 2 }]; // ADMIN
      }
      if (sql.includes("UPDATE projects SET name")) {
        return [{ id: PROJECT_ID, name: args[0] }];
      }
      return [];
    });
    getInstance.mockReturnValue(neon as never);

    const result = await ProjectsController.renameProject(
      ctxFor({ projectId: PROJECT_ID }, { name: "New Name" }),
    );

    const updateCall = neon.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes("UPDATE projects"),
    );
    expect(updateCall).toBeDefined();
    expect((updateCall?.[0] as TemplateStringsArray).join("?")).toMatch(
      /WHERE\s+id\s*=\s*\?/i,
    );
    expect(updateCall?.slice(1)).toEqual(["New Name", PROJECT_ID]);
    expect(result).toMatchObject({ __json: { message: "success" } });
  });

  it("rejects a caller without admin permission", async () => {
    const neon = makeMockDb((sql) => {
      if (sql.includes("SELECT id, team_id FROM projects")) {
        return [{ id: PROJECT_ID, team_id: TEAM_ID }];
      }
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_ID, owner_id: OWNER_ID }];
      }
      if (sql.includes("SELECT permission_id FROM team_members")) return [];
      return [];
    });
    getInstance.mockReturnValue(neon as never);

    const result = await ProjectsController.renameProject(
      ctxFor({ projectId: PROJECT_ID }, { name: "New Name" }),
    );

    expect(result).toMatchObject({ __json: { errors: ["cannot_rename_project"] } });
  });

  it("rejects an invalid body", async () => {
    const result = await ProjectsController.renameProject(
      ctxFor({ projectId: PROJECT_ID }, { name: "" }),
    );

    expect(result).toMatchObject({ __json: { errors: expect.any(Array) } });
  });
});

describe("ProjectsController.getProjectEvents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reads stored events from Turso for an authorized member", async () => {
    const neon = makeMockDb((sql) => {
      if (sql.includes("SELECT projects.id as id")) {
        return [{ id: PROJECT_ID, team_id: TEAM_ID, slug: "alpha" }];
      }
      if (sql.includes("FROM teams")) {
        return [{ owner_id: OWNER_ID }];
      }
      if (sql.includes("SELECT id FROM team_members")) {
        return [{ id: "m1" }];
      }
      return [];
    });
    getInstance.mockReturnValue(neon as never);

    const execute = vi.fn(
      async (_opts: { sql: string; args: unknown[] }) => ({
        rows: [
          { id: 1, session_id: "s1", project_id: PROJECT_ID, name: "click", data: null, created_at: "2026-08-01 10:00:00" },
        ],
      }),
    );
    getTursoInstance.mockReturnValue({ execute } as never);

    const result = await ProjectsController.getProjectEvents(
      ctxFor({ slug: "alpha" }),
    );

    expect(execute).toHaveBeenCalledTimes(1);
    const call = execute.mock.calls[0]?.[0] as unknown as {
      sql: string;
      args: unknown[];
    };
    expect(String(call.sql)).toContain("FROM events");
    expect(call.args).toEqual([PROJECT_ID]);
    expect(result).toMatchObject({
      __json: [{ name: "click", session_id: "s1" }],
    });
  });

  it("denies non-members", async () => {
    const neon = makeMockDb((sql) => {
      if (sql.includes("SELECT projects.id as id")) {
        return [{ id: PROJECT_ID, team_id: TEAM_ID, slug: "alpha" }];
      }
      if (sql.includes("SELECT owner_id FROM teams")) {
        return [{ owner_id: OWNER_ID }];
      }
      if (sql.includes("SELECT id FROM team_members")) return [];
      return [];
    });
    getInstance.mockReturnValue(neon as never);
    const execute = vi.fn();
    getTursoInstance.mockReturnValue({ execute } as never);

    const result = await ProjectsController.getProjectEvents(
      ctxFor({ slug: "alpha" }),
    );

    expect(execute).not.toHaveBeenCalled();
    expect(result).toMatchObject({ __json: { errors: ["project_not_found"] } });
  });
});
