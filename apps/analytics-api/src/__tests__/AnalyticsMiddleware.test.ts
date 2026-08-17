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

type KeyRow = {
  source_id: string;
  key_type: string;
  status: string;
  project_id: string;
  platform: string;
  allowed_origins: string | null;
};

function mockKeyLookup(rows: KeyRow[]) {
  instance.mockImplementation(async (strings: TemplateStringsArray) => {
    if (strings.join("?").includes("project_api_keys")) {
      return Promise.resolve(rows);
    }
    return Promise.resolve([]);
  });
}

function activeWebKey(allowed: string | null = null): KeyRow {
  return {
    source_id: "source-0001",
    key_type: "publishable",
    status: "active",
    project_id: PROJECT_ID,
    platform: "web",
    allowed_origins: allowed ?? '["http://localhost:5173"]',
  };
}

function makeContext(
  authorization: string | undefined,
  origin?: string,
) {
  const vars: Record<string, unknown> = {};
  const ctx = {
    req: {
      header: (name: string) => {
        if (name.toLowerCase() === "origin") return origin;
        return authorization;
      },
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

  it("accepts a valid key and scopes project + trusted source context", async () => {
    mockKeyLookup([activeWebKey()]);
    const ctx = makeContext("Bearer valid-key-456", "http://localhost:5173");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("projectId")).toBe(PROJECT_ID);
    expect(ctx.get("sourceId")).toBe("source-0001");
    expect(ctx.get("platform")).toBe("web");
    expect(ctx.get("keyType")).toBe("publishable");
  });

  it("rejects a revoked key like an unknown key (non-disclosing)", async () => {
    mockKeyLookup([{ ...activeWebKey(), status: "revoked" }]);
    const ctx = makeContext("Bearer revoked-key", "http://localhost:5173");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
    expect(ctx.get("projectId")).toBeUndefined();
  });

  it("rejects a publishable web key from a disallowed origin", async () => {
    mockKeyLookup([activeWebKey('["http://app.example.com"]')]);
    const ctx = makeContext("Bearer web-key", "https://evil.example.com");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).not.toHaveBeenCalled();
  });

  it("enforces the origin policy even when only Referer is present", async () => {
    mockKeyLookup([activeWebKey('["http://app.example.com"]')]);
    const ctx = makeContext("Bearer web-key", "http://app.example.com/path");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
  });

  it("accepts a publishable web key from an allowed origin", async () => {
    mockKeyLookup([activeWebKey()]);
    const ctx = makeContext("Bearer web-key", "http://localhost:5173");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("sourceId")).toBe("source-0001");
  });

  it("applies no origin policy to native or secret server keys", async () => {
    mockKeyLookup([
      {
        source_id: "source-native",
        key_type: "publishable",
        status: "active",
        project_id: PROJECT_ID,
        platform: "ios",
        allowed_origins: "[]",
      },
      {
        source_id: "source-server",
        key_type: "secret",
        status: "active",
        project_id: PROJECT_ID,
        platform: "server",
        allowed_origins: null,
      },
    ]);
    const ctx = makeContext("Bearer native-or-server-key");
    const next = vi.fn();

    await AnalyticsMiddleware(ctx, next);

    expect(next).toHaveBeenCalled();
    expect(ctx.get("sourceId")).toBe("source-native");
  });
});
