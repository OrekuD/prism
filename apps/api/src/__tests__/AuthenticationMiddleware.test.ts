import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { AuthenticationMiddleware } from "../middlewares/AuthenticationMiddleware";

vi.mock("../auth/auth", () => ({
  getAuth: vi.fn(),
}));

import { getAuth } from "../auth/auth";

const getAuthMock = vi.mocked(getAuth);

const USER = {
  id: "11111111-1111-1111-1111-111111111111",
  name: "Test User",
  email: "test@example.com",
  emailVerified: true,
  image: null,
  userName: null,
  role: 1,
};

function mockSession(session: unknown) {
  getAuthMock.mockReturnValue({
    api: { getSession: vi.fn(async () => session) },
  } as never);
}

function makeContext() {
  const vars: Record<string, unknown> = {};
  const ctx = {
    env: { DATABASE_URL: "postgres://test", JWT_SECRET_KEY: "test" },
    req: { raw: { headers: new Headers({ cookie: "prism.session_token=x" }) } },
    json: vi.fn(() => ({ __json: true })),
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    get: (key: string) => vars[key],
  };
  return ctx as unknown as Context;
}

describe("AuthenticationMiddleware (Better Auth session adapter)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("attaches the Better Auth user for a valid cookie session", async () => {
    mockSession({ user: USER, session: { id: "s1" } });
    const ctx = makeContext();
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("user")).toMatchObject({
      id: USER.id,
      email: "test@example.com",
    });
  });

  it("rejects a request without a session", async () => {
    mockSession(null);
    const ctx = makeContext();
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects when the session lookup fails", async () => {
    getAuthMock.mockReturnValue({
      api: {
        getSession: vi.fn(async () => {
          throw new Error("db unavailable");
        }),
      },
    } as never);
    const ctx = makeContext();
    const next = vi.fn();

    await AuthenticationMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });
});

describe("RequireVerifiedEmailMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("blocks unverified users from sensitive actions", async () => {
    const { RequireVerifiedEmailMiddleware } = await import(
      "../middlewares/AuthenticationMiddleware"
    );
    const vars: Record<string, unknown> = { user: { id: "u1", emailVerified: false } };
    const ctx = {
      get: (key: string) => vars[key],
      json: vi.fn(() => ({ __json: true })),
    } as unknown as Context;
    const next = vi.fn();

    await RequireVerifiedEmailMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("allows verified users through", async () => {
    const { RequireVerifiedEmailMiddleware } = await import(
      "../middlewares/AuthenticationMiddleware"
    );
    const vars: Record<string, unknown> = { user: { id: "u1", emailVerified: true } };
    const ctx = {
      get: (key: string) => vars[key],
      json: vi.fn(() => ({ __json: true })),
    } as unknown as Context;
    const next = vi.fn();

    await RequireVerifiedEmailMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
  });
});
