import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import jwt from "@tsndr/cloudflare-worker-jwt";
import { Roles } from "@prism/types";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";

const getInstance = DatabaseManager.getInstance as unknown as ReturnType<
  typeof vi.fn
>;

const SECRET =
  process.env.TEST_JWT_SECRET ?? "test-secret-key-that-is-long-enough-for-hs256";
const USER_ID = "11111111-1111-1111-1111-111111111111";
const OPAQUE_TOKEN = "c".repeat(64);

function mockDb(rows: {
  oauth?: Array<Record<string, unknown>>;
  users?: Array<Record<string, unknown>>;
}) {
  const query = vi.fn(async (strings: TemplateStringsArray) => {
    const sql = strings.join("?").replace(/\s+/g, " ");
    if (sql.includes("oauth_access_tokens")) {
      return rows.oauth ?? [{ id: "tok1", user_id: USER_ID }];
    }
    if (sql.includes("FROM users")) {
      return rows.users ?? [{ id: USER_ID, role: Roles.USER }];
    }
    return [];
  });
  getInstance.mockReturnValue(query);
  return query;
}

function makeContext(env: Record<string, string>, authorization?: string) {
  const vars: Record<string, unknown> = {};
  const ctx = {
    env,
    req: { header: () => authorization },
    json: vi.fn(() => ({ __json: true })),
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    get: (key: string) => vars[key],
  };
  return ctx as unknown as Context;
}

async function signAccessToken(payload: Record<string, unknown>) {
  return jwt.sign(payload, SECRET, { algorithm: "HS256" });
}

describe("API AuthenticationMiddleware (auth path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects a request without an Authorization header", async () => {
    mockDb({});
    const ctx = makeContext({ JWT_SECRET_KEY: SECRET });
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid (tampered) token", async () => {
    mockDb({});
    const ctx = makeContext({ JWT_SECRET_KEY: SECRET }, "Bearer not-a-jwt");
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a valid JWT whose backing OAuth token was revoked or expired", async () => {
    mockDb({ oauth: [] });
    const token = await signAccessToken({
      token: OPAQUE_TOKEN,
      expiryAt: Date.now() + 100000,
      userId: USER_ID,
    });
    const ctx = makeContext({ JWT_SECRET_KEY: SECRET }, `Bearer ${token}`);
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a valid JWT for a suspended/deleted user", async () => {
    mockDb({ users: [] });
    const token = await signAccessToken({
      token: OPAQUE_TOKEN,
      expiryAt: Date.now() + 100000,
      userId: USER_ID,
    });
    const ctx = makeContext({ JWT_SECRET_KEY: SECRET }, `Bearer ${token}`);
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid token, user and OAuth record", async () => {
    const query = mockDb({});
    const token = await signAccessToken({
      token: OPAQUE_TOKEN,
      expiryAt: Date.now() + 100000,
      userId: USER_ID,
    });
    const ctx = makeContext({ JWT_SECRET_KEY: SECRET }, `Bearer ${token}`);
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("user")).toMatchObject({ id: USER_ID });
    expect(ctx.get("oauthAccessTokenId")).toBe("tok1");
    expect(query).toHaveBeenCalled();
  });
});
