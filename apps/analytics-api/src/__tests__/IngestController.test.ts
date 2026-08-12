import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestResponseBody } from "@prism/core";
import { IngestController, eventLimiter } from "../controllers/IngestController.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
  default: { instance: { execute: vi.fn(), batch: vi.fn() } },
}));
vi.mock("../managers/WebSocketManager.js", () => ({
  default: { emitToClient: vi.fn(() => true) },
}));

import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";

const dbBatch = TursoDatabaseManager.instance.batch as unknown as ReturnType<
  typeof vi.fn
>;

const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const VALID_EVENT = {
  schemaVersion: 2,
  eventId: "evt-0001",
  type: "track",
  occurredAt: Date.now(),
  name: "page_viewed",
  properties: { url: "/home", count: 2 },
};

function batch(events: unknown[]): string {
  return JSON.stringify({ schemaVersion: 2, sentAt: Date.now(), events });
}

interface TestCtx {
  req: {
    header: ReturnType<typeof vi.fn>;
    raw: { body: ReadableStream<Uint8Array> };
  };
  header: ReturnType<typeof vi.fn>;
  json: ReturnType<typeof vi.fn>;
  get: () => string;
}

function streamOf(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

function makeContext(body: string, overrides: Record<string, unknown> = {}): TestCtx {
  const headers = new Map<string, string>(
    Object.entries({
      "content-type": "application/json",
      "content-length": String(body.length),
      ...(overrides.headers as Record<string, string>),
    }),
  );
  return {
    req: {
      header: vi.fn((name: string) => headers.get(name.toLowerCase())),
      raw: { body: streamOf(body) },
    },
    header: vi.fn(),
    json: vi.fn((value: unknown, status?: number) => ({ __json: value, status })),
    get: () => (overrides.projectId as string) ?? PROJECT_A,
  };
}

type JsonResult = { __json: unknown; status?: number };

async function ingest(ctx: TestCtx): Promise<JsonResult> {
  return (await IngestController.ingest(ctx as never)) as unknown as JsonResult;
}

describe("IngestController.ingest (v2 batch ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbBatch.mockResolvedValue([{ rows: [], rowsAffected: 1 }]);
    eventLimiter.reset();
  });

  it("rejects a non-JSON content type before parsing", async () => {
    const ctx = makeContext(batch([VALID_EVENT]), {
      headers: { "content-type": "text/plain" },
    });

    const result = await ingest(ctx);

    expect(result.status).toBe(400);
    expect(result.__json).toMatchObject({
      ok: false,
      error: { code: "invalid-envelope" },
    });
    expect(dbBatch).not.toHaveBeenCalled();
  });

  it("rejects oversized requests from the content-length header without reading", async () => {
    const ctx = makeContext(batch([VALID_EVENT]), {
      headers: { "content-length": String(512 * 1024 + 1) },
    });

    const result = await ingest(ctx);

    expect(result.status).toBe(413);
    expect(result.__json).toMatchObject({ ok: false, error: { code: "too-large" } });
    // the stream was never consumed — the declared length short-circuits
    expect(ctx.req.raw.body).toBeDefined();
  });

  it("rejects oversized streamed bodies (no content-length) at the limit", async () => {
    const ctx = makeContext(JSON.stringify({ events: [] }), {
      headers: { "content-length": "0" },
    });
    // replace the stream with one carrying an oversized body — the falsely
    // small declared length must not bypass the bounded read
    const big = batch([{ ...VALID_EVENT, properties: { pad: "x".repeat(600_000) } }]);
    ctx.req.raw.body = streamOf(big);

    const result = await ingest(ctx);

    expect(result.status).toBe(413);
    expect(result.__json).toMatchObject({ ok: false, error: { code: "too-large" } });
  });

  it("rejects invalid JSON with a coarse code", async () => {
    const ctx = makeContext("{not json");

    const result = await ingest(ctx);

    expect(result.status).toBe(400);
    expect(result.__json).toMatchObject({ ok: false, error: { code: "invalid-envelope" } });
    expect(dbBatch).not.toHaveBeenCalled();
  });

  it.each([
    ["missing schemaVersion", JSON.stringify({ events: [] })],
    ["wrong schemaVersion", JSON.stringify({ schemaVersion: 1, events: [] })],
    ["empty events", JSON.stringify({ schemaVersion: 2, events: [] })],
    [
      "too many events",
      JSON.stringify({ schemaVersion: 2, events: Array.from({ length: 51 }, () => VALID_EVENT) }),
    ],
  ])("rejects envelope %s before any insert", async (_label, body) => {
    const ctx = makeContext(body);

    const result = await ingest(ctx);

    expect(result.status).toBe(400);
    expect(result.__json).toMatchObject({ ok: false, error: { code: "invalid-envelope" } });
    expect(dbBatch).not.toHaveBeenCalled();
  });

  it("accepts a valid batch and stores sanitized events for the key's project", async () => {
    const ctx = makeContext(batch([VALID_EVENT]));

    const result = await ingest(ctx);

    expect(result.status).toBe(200);
    const body = result.__json as IngestResponseBody;
    expect(body.ok).toBe(true);
    expect(body.results).toEqual([{ index: 0, id: "evt-0001", status: "accepted" }]);

    expect(dbBatch).toHaveBeenCalledTimes(1);
    const [statements] = dbBatch.mock.calls[0];
    const { sql, args } = statements[0];
    expect(String(sql)).toContain("INSERT INTO events");
    expect(String(sql)).toContain("ON CONFLICT (project_id, id) DO NOTHING");
    expect(args).toEqual([
      "evt-0001",
      PROJECT_A, // derived from the key, never from the body
      "track",
      "page_viewed",
      2,
      VALID_EVENT.occurredAt,
      expect.any(Number), // server receivedAt
      null,
      null,
      JSON.stringify({ url: "/home", count: 2 }),
      "{}", // no context
      null, // no batch sdk name
      null, // no batch sdk version
    ]);
  });

  it("ignores client-provided ownership fields", async () => {
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, projectId: "evil-project", teamId: "evil-team" }]),
    );

    await IngestController.ingest(ctx as never);

    const [statements] = dbBatch.mock.calls[0];
    const { args } = statements[0];
    expect(args).toContain(PROJECT_A);
    expect(args).not.toContain("evil-project");
  });

  it("marks a replayed event as duplicate via the conflict-safe insert", async () => {
    dbBatch.mockResolvedValue([{ rows: [], rowsAffected: 0 }]);
    const ctx = makeContext(batch([VALID_EVENT]));

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    expect(body.results).toEqual([{ index: 0, id: "evt-0001", status: "duplicate" }]);
  });

  it("rejects per-event failures with coarse reasons and still accepts the rest", async () => {
    const badName = { ...VALID_EVENT, eventId: "evt-bad-name", name: "\u0000" };
    const badTimestamp = {
      ...VALID_EVENT,
      eventId: "evt-bad-time",
      occurredAt: Date.now() + 3600_000, // 1 hour in the future
    };
    // object literals cannot carry an own __proto__ key — build via JSON
    const dangerous = JSON.parse(
      `{"schemaVersion":2,"eventId":"evt-dangerous","type":"track","occurredAt":${VALID_EVENT.occurredAt},"name":"x","properties":{"__proto__":{"polluted":true}}}`,
    );
    const ctx = makeContext(
      batch([VALID_EVENT, badName, badTimestamp, dangerous, VALID_EVENT]),
    );
    // two valid events → two atomic-batch results, both accepted
    dbBatch.mockResolvedValue([
      { rows: [], rowsAffected: 1 },
      { rows: [], rowsAffected: 1 },
    ]);

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    expect(body.results).toEqual([
      { index: 0, id: "evt-0001", status: "accepted" },
      { index: 1, id: "evt-bad-name", status: "rejected", reason: "invalid-name" },
      { index: 2, id: "evt-bad-time", status: "rejected", reason: "invalid-timestamp" },
      { index: 3, id: "evt-dangerous", status: "rejected", reason: "invalid-properties" },
      { index: 4, id: "evt-0001", status: "accepted" },
    ]);
    // only the two valid events entered the transaction
    const [statements] = dbBatch.mock.calls[0];
    expect(statements).toHaveLength(2);
  });

  it("rejects unsupported event types, non-finite numbers, and oversized events", async () => {
    const unsupported = { ...VALID_EVENT, eventId: "evt-type", type: "page" };
    // JSON.stringify would turn Infinity into null — build the raw body
    // with `1e400` so JSON.parse produces a real non-finite number.
    const nonFiniteRaw = `{"schemaVersion":2,"eventId":"evt-nan","type":"track","occurredAt":${VALID_EVENT.occurredAt},"name":"x","properties":{"score":1e400}}`;
    // 4 × 9 900 chars stays under the string cap but exceeds 32 KiB serialized.
    const oversized = {
      ...VALID_EVENT,
      eventId: "evt-big",
      properties: {
        pad: ["x".repeat(9_900), "x".repeat(9_900), "x".repeat(9_900), "x".repeat(9_900)],
      },
    };
    // string concatenation — JSON.stringify would turn Infinity into null
    const requestBody =
      `{"schemaVersion":2,"sentAt":${Date.now()},"events":[` +
      `${JSON.stringify(unsupported)},${nonFiniteRaw},${JSON.stringify(oversized)}]}`;
    const ctx = makeContext(requestBody);

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    expect(body.results).toEqual([
      { index: 0, id: "evt-type", status: "rejected", reason: "unsupported-type" },
      { index: 1, id: "evt-nan", status: "rejected", reason: "invalid-properties" },
      { index: 2, id: "evt-big", status: "rejected", reason: "too-large" },
    ]);
    expect(dbBatch).not.toHaveBeenCalled();
  });

  it("sanitizes credentials on the server even when the client did not", async () => {
    const ctx = makeContext(
      batch([
        { ...VALID_EVENT, properties: { password: "hunter2", ok: true, nested: { token: "abc" } } },
      ]),
    );

    await IngestController.ingest(ctx as never);

    const [statements] = dbBatch.mock.calls[0];
    const { args } = statements[0];
    const stored = JSON.parse(String(args[9])) as Record<string, unknown>;
    expect(stored.password).toBe("[REDACTED]");
    expect((stored.nested as Record<string, unknown>).token).toBe("[REDACTED]");
    expect(stored.ok).toBe(true);
  });

  it("never echoes properties, values, or keys in the response", async () => {
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, properties: { secret: "value-123", password: "pw" } }]),
    );

    const result = await ingest(ctx);

    const serialized = JSON.stringify(result.__json);
    expect(serialized).not.toContain("value-123");
    expect(serialized).not.toContain("pw");
    expect(serialized).not.toContain("secret");
    expect(serialized).not.toContain("properties");
  });

  it("returns 429 with Retry-After when the event-weighted quota is exceeded", async () => {
    vi.spyOn(eventLimiter, "hit").mockReturnValueOnce({
      allowed: false,
      retryAfterSeconds: 7,
    });
    const ctx = makeContext(batch([VALID_EVENT]));

    const result = await ingest(ctx);

    expect(result.status).toBe(429);
    expect(result.__json).toMatchObject({ ok: false, error: { code: "rate-limited" } });
    expect(ctx.header).toHaveBeenCalledWith("Retry-After", "7");
    expect(dbBatch).not.toHaveBeenCalled();
  });

  it("weights the quota by the submitted event count", async () => {
    const hit = vi.spyOn(eventLimiter, "hit");
    const ctx = makeContext(batch([VALID_EVENT, VALID_EVENT, VALID_EVENT]));

    await IngestController.ingest(ctx as never);

    expect(hit).toHaveBeenCalledWith(PROJECT_A, 3);
  });
});
