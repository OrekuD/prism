import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "hono";
import { AnalyticsMiddleware } from "../middlewares/AnalyticsMiddleware.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));

import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";

const instance = NeonDatabaseManager.instance as unknown as ReturnType<
  typeof vi.fn
>;

function mockKeyLookup(rows: Array<{ project_id: string }>) {
  instance.mockImplementation(async (strings: TemplateStringsArray) => {
    if (strings.join("?").includes("project_api_keys")) {
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
}

function makeContext(authorization: string | undefined) {
  const vars: Record<string, unknown> = {};
  const ctx = {
    req: {
      header: () => authorization,
    },
    json: vi.fn(() => ({ __json: true })),
    set: (key: string, value: unknown) => {
      vars[key] = value;
    },
    get: (key: string) => vars[key],
  };
  return ctx as unknown as Context;
}

const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

describe("AnalyticsMiddleware", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects requests without an Authorization header", async () => {
    mockKeyLookup([]);
    const ctx = makeContext(undefined);
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a malformed Authorization header", async () => {
    mockKeyLookup([]);
    const ctx = makeContext("Token abc123");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("rejects an invalid analytics key", async () => {
    mockKeyLookup([]);
    const ctx = makeContext("Bearer invalid-key-123");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("accepts a valid key and scopes the projectId", async () => {
    mockKeyLookup([{ project_id: PROJECT_ID }]);
    const ctx = makeContext("Bearer valid-key-456");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("projectId")).toBe(PROJECT_ID);
  });
});
