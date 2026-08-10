import "./testEnv.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { app, ingestionLimiter } from "../app.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
  default: { instance: { execute: vi.fn() } },
}));
vi.mock("../managers/WebSocketManager.js", () => ({
  default: { emitToClient: vi.fn(() => true) },
}));

import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";

const instance = NeonDatabaseManager.instance as unknown as ReturnType<
  typeof vi.fn
>;

function postSessions(origin?: string, ip?: string) {
  return app.request("/api/v1/analytics/sessions", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({ referrer: "x", userAgent: "y", location: "z" }),
  });
}

describe("analytics API boundary (CORS + rate limits)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestionLimiter.reset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("allows ingestion from any browser origin (documented public policy)", async () => {
    instance.mockResolvedValue([]);

    const response = await postSessions("https://customer-site.example");

    // Key-based auth still applies; CORS must not block the browser SDK.
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.status).toBe(401); // invalid key
  });

  it("returns 429 with Retry-After past the ingestion limit", async () => {
    instance.mockResolvedValue([]);

    for (let i = 0; i < 120; i += 1) {
      const response = await postSessions(undefined, "203.0.113.99");
      expect(response.status).toBe(401);
    }

    const blocked = await postSessions(undefined, "203.0.113.99");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ errors: ["rate_limited"] });
  });

  it("does not count different client IPs against each other", async () => {
    instance.mockResolvedValue([]);

    for (let i = 0; i < 120; i += 1) {
      await postSessions(undefined, "198.51.100.1");
    }

    // A different IP still has its own budget.
    const response = await postSessions(undefined, "198.51.100.2");
    expect(response.status).toBe(401);
  });
});
