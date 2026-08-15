import "./testEnv.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
// The bundled nginx overwrites X-Forwarded-For with the real peer address
// and clears CF-Connecting-IP; the analytics service trusts X-Forwarded-For
// in "nginx" mode (F12 + harden F22).
process.env.ANALYTICS_TRUSTED_PROXY = "nginx";
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

function postIngest(origin?: string, ip?: string) {
  return app.request("/api/v2/ingest", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(origin ? { origin } : {}),
      ...(ip ? { "x-forwarded-for": ip } : {}),
    },
    body: JSON.stringify({
      schemaVersion: 2,
      events: [
        {
          schemaVersion: 2,
          eventId: "boundary-1",
          type: "track",
          occurredAt: Date.now(),
          name: "boundary_check",
        },
      ],
    }),
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

    const response = await postIngest("https://customer-site.example");

    // Key-based auth still applies; CORS must not block the browser SDK.
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    expect(response.status).toBe(401); // invalid key
  });

  it("returns 429 with Retry-After past the ingestion limit", async () => {
    instance.mockResolvedValue([]);

    for (let i = 0; i < 120; i += 1) {
      const response = await postIngest(undefined, "203.0.113.99");
      expect(response.status).toBe(401);
    }

    const blocked = await postIngest(undefined, "203.0.113.99");
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({ errors: ["rate_limited"] });
  });

  it("v2 ingest requires a valid bearer key (missing/malformed/wrong → 401)", async () => {
    instance.mockResolvedValue([]);
    const envelope = JSON.stringify({
      schemaVersion: 2,
      events: [
        {
          schemaVersion: 2,
          eventId: "boundary-1",
          type: "track",
          occurredAt: Date.now(),
          name: "boundary_check",
        },
      ],
    });
    const post = (headers: Record<string, string>) =>
      app.request("/api/v2/ingest", {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: envelope,
      });

    const missing = await post({});
    expect(missing.status).toBe(401);
    const malformed = await post({ authorization: "Basic abc" });
    expect(malformed.status).toBe(401);
    const wrong = await post({ authorization: "Bearer not-a-real-key" });
    expect(wrong.status).toBe(401);
    // exact-scheme rejection (F23): prefixed/suffixed junk never passes
    const prefixed = await post({ authorization: "Basic Bearer not-a-real-key" });
    expect(prefixed.status).toBe(401);
    const suffixed = await post({ authorization: "Bearer not-a-real-key extra" });
    expect(suffixed.status).toBe(401);
    const emptyKey = await post({ authorization: "Bearer " });
    expect(emptyKey.status).toBe(401);
  });

  it("untrusted proxy mode ignores forged forwarding headers (peer identity wins)", async () => {
    instance.mockResolvedValue([]);
    process.env.ANALYTICS_TRUSTED_PROXY = "none"; // untrusted mode

    // forged XFF values must NOT rotate the rate-limit key when the peer
    // is not a trusted proxy — the limiter still 401s on key auth for the
    // first requests; the point is the KEY stays stable per peer
    const responses = [];
    for (let i = 0; i < 121; i += 1) {
      responses.push(
        await app.request("/api/v2/ingest", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-forwarded-for": `203.0.113.${i}`, // rotated attacker-controlled hop
          },
          body: JSON.stringify({
            schemaVersion: 2,
            events: [
              {
                schemaVersion: 2,
                eventId: `boundary-${i}`,
                type: "track",
                occurredAt: Date.now(),
                name: "boundary_check",
              },
            ],
          }),
        }),
      );
    }
    // every request shared ONE key (the peer/local bucket) → 429 once the
    // single budget is exhausted, regardless of the forged header values
    expect(responses[responses.length - 1].status).toBe(429);
    process.env.ANALYTICS_TRUSTED_PROXY = "nginx";
  });

  it("does not count different client IPs against each other", async () => {
    instance.mockResolvedValue([]);

    for (let i = 0; i < 120; i += 1) {
      await postIngest(undefined, "198.51.100.1");
    }

    // A different IP still has its own budget.
    const response = await postIngest(undefined, "198.51.100.2");
    expect(response.status).toBe(401);
  });
});

describe("release review — readiness + dead route", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ingestionLimiter.reset();
  });

  it("removed the production /test route (404)", async () => {
    const response = await app.request("/test");
    expect(response.status).toBe(404);
  });

  it("reports ready only for a fully migrated store (journal + sessions_v2)", async () => {
    const turso = (await import("../managers/TursoDatabaseManager.js")).default
      .instance as unknown as { execute: ReturnType<typeof vi.fn> };
    const execute = turso.execute;
    execute.mockImplementation((input: string | { sql: string }) => {
      const sql = String(typeof input === "string" ? input : input.sql);
      if (sql.includes("schema_migrations")) {
        return Promise.resolve({ rows: [{ version: 6 }] });
      }
      return Promise.resolve({ rows: [{}] }); // sessions_v2 exists
    });

    const response = await app.request("/health/ready");
    expect(response.status).toBe(200);
  });

  it("reports 503 when the journal is behind or missing", async () => {
    const turso = (await import("../managers/TursoDatabaseManager.js")).default
      .instance as unknown as { execute: ReturnType<typeof vi.fn> };
    turso.execute.mockImplementation((input: string | { sql: string }) => {
      const sql = String(typeof input === "string" ? input : input.sql);
      if (sql.includes("schema_migrations")) {
        return Promise.resolve({ rows: [{ version: 2 }] }); // behind
      }
      return Promise.resolve({ rows: [{}] });
    });

    const response = await app.request("/health/ready");
    expect(response.status).toBe(503);
  });

  it("reports 503 when sessions_v2 is missing", async () => {
    const turso = (await import("../managers/TursoDatabaseManager.js")).default
      .instance as unknown as { execute: ReturnType<typeof vi.fn> };
    turso.execute.mockImplementation((input: string | { sql: string }) => {
      const sql = String(typeof input === "string" ? input : input.sql);
      if (sql.includes("schema_migrations")) {
        return Promise.resolve({ rows: [{ version: 6 }] });
      }
      return Promise.reject(new Error("no such table: sessions_v2"));
    });

    const response = await app.request("/health/ready");
    expect(response.status).toBe(503);
  });
});
