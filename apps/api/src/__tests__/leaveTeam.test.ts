import { beforeEach, describe, expect, it, vi } from "vitest";
import { TeamsController } from "../controllers/TeamsController";
import { makeMockDb, makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const TEAM_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const TEAM_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const OTHER_OWNER = "33333333-3333-3333-3333-333333333333";

function ctxFor(teamId: string) {
  return makeCtx({ teamId }, {}, {
    user: { id: USER_ID, user_name: null },
  });
}

describe("TeamsController.leaveTeam (team scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("deletes only the requested team's membership", async () => {
    const query = makeMockDb((sql, args) => {
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_A, owner_id: OTHER_OWNER }];
      }
      if (sql.includes("DELETE FROM team_members")) {
        // postgres client reports affected rows; our mock reports the row
        return [];
      }
      return [];
    });
    getInstance.mockReturnValue(query as never);

    await TeamsController.leaveTeam(ctxFor(TEAM_A));

    const deleteCall = query.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes(
        "DELETE FROM team_members",
      ),
    );
    expect(deleteCall).toBeDefined();
    const sql = (deleteCall?.[0] as TemplateStringsArray).join("?");
    const args = deleteCall?.slice(1);

    // The killer bug: DELETE filtered only by user_id, removing every
    // membership the user had across all teams.
    expect(sql).toMatch(/user_id\s*=\s*\?/i);
    expect(sql).toMatch(/team_id\s*=\s*\?/i);
    expect(args).toEqual([USER_ID, TEAM_A]);
    expect(args).not.toContain(TEAM_B);
  });

  it("prevents a team owner from leaving their own team", async () => {
    const query = makeMockDb((sql) => {
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_A, owner_id: USER_ID }];
      }
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await TeamsController.leaveTeam(ctxFor(TEAM_A));

    expect(result).toMatchObject({ __json: { errors: ["team_owner"] } });
    const deletes = query.mock.calls.filter(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes("DELETE"),
    );
    expect(deletes).toHaveLength(0);
  });

  it("returns a consistent response when the caller is not a member", async () => {
    const query = makeMockDb((sql) => {
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_A, owner_id: OTHER_OWNER }];
      }
      if (sql.includes("DELETE FROM team_members")) {
        // 0 rows affected => the user was not a member
        return [];
      }
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await TeamsController.leaveTeam(ctxFor(TEAM_A));

    expect(result).toMatchObject({
      __json: { errors: ["team_membership_not_found"] },
    });
  });

  it("leaves the user's membership in other teams untouched", async () => {
    const query = makeMockDb((sql) => {
      if (sql.includes("SELECT id, owner_id FROM teams")) {
        return [{ id: TEAM_A, owner_id: OTHER_OWNER }];
      }
      return [];
    });
    getInstance.mockReturnValue(query as never);

    await TeamsController.leaveTeam(ctxFor(TEAM_A));

    const deleteCall = query.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes(
        "DELETE FROM team_members",
      ),
    );
    // Only the requested team id may appear in the DELETE args.
    expect(deleteCall?.slice(1)).toEqual([USER_ID, TEAM_A]);
  });
});
