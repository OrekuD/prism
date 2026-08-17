import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { SetupController } from "../controllers/SetupController";
import type { HonoConfig } from "../types/types";

/**
 * First-owner setup hardening tests: token gate, atomic claim, stale-claim
 * recovery, rollback, replay closure, hosted-mode refusal, and rate limit.
 *
 * The product database is a scripted fake; better-auth and provisioning
 * are mocked so each case can force success or failure deterministically.
 */

const mocks = vi.hoisted(() => ({
  signUpEmail: vi.fn(),
  provisionUserResources: vi.fn(),
  createPersonalWorkspace: vi.fn(),
}));
vi.mock("better-auth", () => ({
  betterAuth: vi.fn(() => ({
    api: {
      signUpEmail: mocks.signUpEmail,
      createOrganization: vi.fn(async () => ({ id: "org-1" })),
    },
  })),
}));
vi.mock("better-auth/adapters/drizzle", () => ({
  drizzleAdapter: (db: unknown) => db,
}));
vi.mock("../auth/provision", () => ({
  provisionUserResources: mocks.provisionUserResources,
  createPersonalWorkspace: mocks.createPersonalWorkspace,
}));

type QueryCall = { sql: string; values: unknown[] };
const queryCalls: QueryCall[] = [];
let queryBehavior: (call: QueryCall) => unknown = () => [];

const queryFn = vi.fn(async (strings: TemplateStringsArray, ...values: unknown[]) => {
  const call = { sql: strings.join("?"), values };
  queryCalls.push(call);
  return queryBehavior(call) as Array<Record<string, unknown>>;
});

vi.mock("../database/db", () => ({
  createProductDb: vi.fn(() => ({ query: queryFn, drizzle: {} })),
}));

const baseEnv = {
  DATABASE_URL: "postgres://test",
  JWT_SECRET_KEY: "x".repeat(48),
  CLIENT_URL: "http://localhost:5173",
  BASE_URL: "http://localhost:8787",
  IMAGE_KIT_API_KEY: "test-imagekit-key",
  PRISM_DEPLOYMENT_MODE: "self-hosted",
  ENVIRONMENT: "development",
  SETUP_TOKEN: "test-setup-token-123456",
};

const TOKEN = baseEnv.SETUP_TOKEN;
const OWNER = { name: "Test Owner", email: "owner@test.dev", password: "password123" };

function makeCtx(body: unknown, token?: string): Context<HonoConfig> {
  const headers = new Headers({ "x-forwarded-for": "203.0.113.9" });
  if (token !== undefined) headers.set("x-setup-token", token);
  return {
    env: { ...baseEnv },
    req: {
      header: (name: string) => headers.get(name) ?? undefined,
      raw: { headers },
      json: async () => body,
    },
    json: (payload: unknown, status = 200) => ({ payload, status }),
  } as unknown as Context<HonoConfig>;
}

/** Returns { payload, status } from the ctx.json mock. */
type SetupResult = { payload: { errors?: string[]; ok?: boolean }; status?: number };

function callsFor(sqlFragment: string): QueryCall[] {
  return queryCalls.filter((call) => call.sql.includes(sqlFragment));
}

beforeEach(() => {
  vi.clearAllMocks();
  queryCalls.length = 0;
  queryBehavior = (call) => {
    if (call.sql.includes('SELECT id FROM "user" LIMIT 1')) return [];
    return [];
  };
  mocks.signUpEmail.mockResolvedValue({
    user: { id: "owner-1", name: OWNER.name, email: OWNER.email },
  });
  mocks.provisionUserResources.mockResolvedValue(undefined);
  SetupController.resetRateLimitForTests();
});

describe("SetupController.createOwner", () => {
  it("refuses in hosted mode (404, no token consumed)", async () => {
    const ctx = makeCtx(OWNER, TOKEN);
    ctx.env = { ...baseEnv, PRISM_DEPLOYMENT_MODE: "hosted" } as never;
    const result = (await SetupController.createOwner(ctx)) as unknown as SetupResult;
    expect(result.status).toBe(404);
  });

  it("requires the setup token (401 without or wrong)", async () => {
    const noToken = (await SetupController.createOwner(makeCtx(OWNER))) as unknown as SetupResult;
    expect(noToken.status).toBe(401);
    expect(noToken.payload.errors).toEqual(["setup_token_required"]);

    const wrongToken = (await SetupController.createOwner(
      makeCtx(OWNER, "not-the-token"),
    )) as unknown as SetupResult;
    expect(wrongToken.status).toBe(401);
  });

  it("creates a verified ADMIN owner, provisions, and keeps the claim", async () => {
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;

    expect(result.status).toBe(200);
    expect(result.payload).toEqual({ ok: true });
    expect(mocks.signUpEmail).toHaveBeenCalledWith({
      body: { email: OWNER.email, password: OWNER.password, name: OWNER.name },
    });

    const update = callsFor('UPDATE "user" SET role')[0];
    expect(update).toBeDefined();
    expect(update.sql).toContain("email_verified = true");
    expect(mocks.provisionUserResources).toHaveBeenCalledOnce();
    // Success keeps the claim (setup stays closed).
    expect(callsFor("DELETE FROM setup_claim")).toHaveLength(0);
    expect(callsFor("INSERT INTO setup_claim")).toHaveLength(1);
  });

  it("closes permanently once a user exists (404 replay)", async () => {
    queryBehavior = (call) => {
      if (call.sql.includes('SELECT id FROM "user" LIMIT 1')) return [{ id: "x" }];
      return [];
    };
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(404);
    expect(mocks.signUpEmail).not.toHaveBeenCalled();
  });

  it("returns 409 while a fresh claim is held (concurrency)", async () => {
    queryBehavior = (call) => {
      if (call.sql.includes('SELECT id FROM "user" LIMIT 1')) return [];
      if (call.sql.includes("INSERT INTO setup_claim")) {
        throw new Error("UNIQUE constraint failed: setup_claim.id");
      }
      if (call.sql.includes("SELECT claimed_at")) {
        return [{ claimed_at: Date.now() }];
      }
      return [];
    };
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(409);
    expect(result.payload.errors).toEqual(["setup_in_progress"]);
  });

  it("recovers a stale claim (older than TTL, zero users)", async () => {
    let claimInserts = 0;
    queryBehavior = (call) => {
      if (call.sql.includes('SELECT id FROM "user" LIMIT 1')) return [];
      if (call.sql.includes("INSERT INTO setup_claim")) {
        claimInserts += 1;
        if (claimInserts === 1) {
          throw new Error("UNIQUE constraint failed: setup_claim.id");
        }
        return [];
      }
      if (call.sql.includes("SELECT claimed_at")) {
        return [{ claimed_at: Date.now() - 10 * 60 * 1000 }];
      }
      if (call.sql.includes("DELETE FROM setup_claim")) return [];
      return [];
    };
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(200);
    expect(claimInserts).toBe(2);
    expect(callsFor("DELETE FROM setup_claim")).toHaveLength(1);
  });

  it("returns 503 when the claim table is missing (migration not applied)", async () => {
    queryBehavior = () => {
      throw new Error('relation "setup_claim" does not exist');
    };
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(503);
    expect(result.payload.errors).toEqual(["database_not_ready"]);
  });

  it("rolls the account back when promotion fails (no partial owner)", async () => {
    queryBehavior = (call) => {
      if (call.sql.includes('SELECT id FROM "user" LIMIT 1')) return [];
      if (call.sql.includes('UPDATE "user" SET role')) {
        throw new Error("boom");
      }
      return [];
    };
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(500);
    expect(callsFor("DELETE FROM session WHERE user_id")).toHaveLength(1);
    expect(callsFor("DELETE FROM account WHERE user_id")).toHaveLength(1);
    expect(callsFor('DELETE FROM "user" WHERE id')).toHaveLength(1);
    expect(callsFor("DELETE FROM setup_claim")).toHaveLength(1);
  });

  it("rolls the account back when provisioning fails", async () => {
    mocks.provisionUserResources.mockRejectedValueOnce(new Error("provision boom"));
    const result = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(result.status).toBe(500);
    expect(callsFor('DELETE FROM "user" WHERE id')).toHaveLength(1);
    expect(callsFor("DELETE FROM setup_claim")).toHaveLength(1);
  });

  it("rejects weak passwords and invalid bodies without keeping the claim", async () => {
    const weak = (await SetupController.createOwner(
      makeCtx({ ...OWNER, password: "short" }, TOKEN),
    )) as unknown as SetupResult;
    expect(weak.status).toBe(400);
    expect(callsFor("DELETE FROM setup_claim")).toHaveLength(1);

    const invalid = (await SetupController.createOwner(
      makeCtx({ name: "", email: "", password: "" }, TOKEN),
    )) as unknown as SetupResult;
    expect(invalid.status).toBe(400);
  });

  it("rate limits repeated attempts per IP (429)", async () => {
    for (let i = 0; i < 5; i++) {
      const result = (await SetupController.createOwner(
        makeCtx(OWNER, "wrong-token"),
      )) as unknown as SetupResult;
      expect(result.status).toBe(401);
    }
    const limited = (await SetupController.createOwner(
      makeCtx(OWNER, TOKEN),
    )) as unknown as SetupResult;
    expect(limited.status).toBe(429);
    expect(limited.payload.errors).toEqual(["rate_limited"]);
  });
});
