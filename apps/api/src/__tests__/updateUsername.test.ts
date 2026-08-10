import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserController } from "../controllers/UserController";
import { makeMockDb, makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

function ctxFor(username: string) {
  return makeCtx({}, { userName: username }, {
    user: { id: USER_ID, user_name: "old-name" },
  });
}

describe("UserController.updateUsername (row scoping)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates exactly one row: only the authenticated user's", async () => {
    const query = makeMockDb((sql, args) => {
      if (sql.includes("SELECT id FROM users WHERE user_name")) return [];
      if (sql.includes("UPDATE users SET user_name")) return [{ id: USER_ID }];
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await UserController.updateUsername(ctxFor("new-name"));

    const updateCall = query.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes("UPDATE users"),
    );
    expect(updateCall).toBeDefined();
    const sql = (updateCall?.[0] as TemplateStringsArray).join("?");
    const args = updateCall?.slice(1);

    // The killer bug: the UPDATE had no WHERE clause and rewrote every row.
    expect(sql).toMatch(/WHERE\s+id\s*=\s*\?/i);
    expect(args).toContain(USER_ID);
    expect(result).toMatchObject({ __json: { username: "new-name" } });
  });

  it("rejects a duplicate username case-insensitively", async () => {
    const query = makeMockDb((sql, args) => {
      if (sql.includes("SELECT id FROM users WHERE")) {
        return [{ id: OTHER_USER_ID }];
      }
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await UserController.updateUsername(ctxFor("New-Name"));

    // Uniqueness lookup must be case-insensitive (LOWER() on both sides).
    const lookupCall = query.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes(
        "SELECT id FROM users WHERE",
      ),
    );
    expect((lookupCall?.[0] as TemplateStringsArray).join("?")).toMatch(
      /lower\(user_name\)/i,
    );
    expect(result).toMatchObject({ __json: { errors: ["username_taken"] } });
  });

  it("treats a missing updated row as an update failure", async () => {
    const query = makeMockDb((sql) => {
      if (sql.includes("SELECT id FROM users WHERE")) return [];
      if (sql.includes("UPDATE users")) return [];
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await UserController.updateUsername(ctxFor("new-name"));

    expect(result).toMatchObject({
      __json: { errors: ["profile_not_updated"] },
    });
  });

  it("never touches another user's row", async () => {
    const query = makeMockDb((sql, args) => {
      if (sql.includes("SELECT id FROM users WHERE")) return [];
      if (sql.includes("UPDATE users SET user_name")) return [{ id: USER_ID }];
      return [];
    });
    getInstance.mockReturnValue(query as never);

    await UserController.updateUsername(ctxFor("new-name"));

    const updateCall = query.mock.calls.find(([sql]) =>
      String((sql as TemplateStringsArray).join("?")).includes(
        "UPDATE users",
      ),
    );
    // The WHERE must reference the authenticated user, not any other id.
    expect(updateCall?.slice(1)).toContain(USER_ID);
    expect(updateCall?.slice(1)).not.toContain(OTHER_USER_ID);
  });
});
