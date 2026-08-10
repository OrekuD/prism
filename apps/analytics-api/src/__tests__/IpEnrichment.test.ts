import "./testEnv.js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AnalyticsController } from "../controllers/AnalyticsController.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
  default: { instance: { execute: vi.fn() } },
}));
vi.mock("../managers/WebSocketManager.js", () => ({
  default: { emitToClient: vi.fn(() => true) },
}));

import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";

const execute = TursoDatabaseManager.instance.execute as unknown as ReturnType<
  typeof vi.fn
>;

const PROJECT_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

function makeContext(clientIp?: string) {
  return {
    req: {
      json: vi.fn(async () => ({
        referrer: "https://example.com",
        userAgent:
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        location: "Accra",
      })),
      header: vi.fn(() => clientIp),
      raw: { headers: new Headers() },
    },
    json: vi.fn((value: unknown) => ({ __json: value })),
    get: () => PROJECT_ID,
  } as never;
}

function lastInsert() {
  const call = execute.mock.calls[execute.mock.calls.length - 1] as [
    { sql: string; args: Array<unknown> },
  ];
  const { sql, args } = call[0];
  const columns = String(sql)
    .replace(/INSERT INTO sessions \((.*?)\) VALUES/, "$1")
    .split(",")
    .map((c) => c.trim());
  return Object.fromEntries(
    columns.map((column, index) => [column, args[index]]),
  );
}

describe("AnalyticsController.startSession (resilient IP enrichment)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    execute.mockResolvedValue({
      rows: [{ session_id: "sess-1" }],
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it("creates a session when no IP_INFO_API_TOKEN is configured", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "");
    const fetchMock = vi.fn(async () => {
      throw new Error("should never be called");
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await AnalyticsController.startSession(makeContext());

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    const insert = lastInsert();
    expect(insert.country_code).toBeNull();
    expect(insert.lat).toBeNull();
    expect(insert.long).toBeNull();
  });

  it("creates a session when the enrichment request fails (network error)", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    );

    const result = await AnalyticsController.startSession(makeContext());

    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    const insert = lastInsert();
    expect(insert.country_code).toBeNull();
    expect(insert.lat).toBeNull();
  });

  it("creates a session when enrichment returns a non-2xx response", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: false, status: 429 })),
    );

    const result = await AnalyticsController.startSession(makeContext());

    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    expect(lastInsert().country_code).toBeNull();
  });

  it("creates a session when enrichment returns invalid JSON", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: vi.fn(async () => {
          throw new SyntaxError("Unexpected token");
        }),
      })),
    );

    const result = await AnalyticsController.startSession(makeContext());

    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    expect(lastInsert().country_code).toBeNull();
  });

  it("creates a session when the response has no loc field", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: vi.fn(async () => ({ country: "GH", org: "x" })),
      })),
    );

    const result = await AnalyticsController.startSession(makeContext());

    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    const insert = lastInsert();
    expect(insert.country_code).toBeNull();
    expect(insert.lat).toBeNull();
  });

  it("records validated country and coordinates on success", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "test-token");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({
        ok: true,
        json: vi.fn(async () => ({
          country: "GH",
          loc: "5.6037,-0.1870",
          org: "Some ISP",
        })),
      })),
    );

    const result = await AnalyticsController.startSession(
      makeContext("154.161.151.38"),
    );

    expect(result).toMatchObject({ __json: { sessionId: "sess-1" } });
    const insert = lastInsert();
    expect(insert.country_code).toBe("GH");
    expect(insert.lat).toBe("5.6037");
    expect(insert.long).toBe("-0.1870");
  });

  it("never uses a hardcoded public fallback IP", async () => {
    vi.stubEnv("IP_INFO_API_TOKEN", "");
    vi.stubGlobal("fetch", vi.fn());

    await AnalyticsController.startSession(makeContext());

    const insert = lastInsert();
    // Local/unknown value in development; not a real external IP.
    expect(["127.0.0.1", "::1", "::ffff:127.0.0.1", ""]).toContain(
      String(insert.ip),
    );
  });
});
