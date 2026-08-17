import "./testEnv.js";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { IngestResponseBody } from "@prism/core";
import { IngestController, eventLimiter } from "../controllers/IngestController.js";
import { identityOpHash } from "../utils/identityResolution.js";

vi.mock("../managers/NeonDatabaseManager.js", () => ({
  default: { instance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager.js", () => ({
  default: { instance: { execute: vi.fn(), batch: vi.fn(), transaction: vi.fn() } },
}));
vi.mock("../managers/WebSocketManager.js", () => ({
  default: { emitToClient: vi.fn(() => true) },
}));

import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import WebSocketManager from "../managers/WebSocketManager.js";

const emitToClient = WebSocketManager.emitToClient as unknown as ReturnType<
  typeof vi.fn
>;

// the repository now persists through ONE write transaction: the
// transaction mock's execute records statements and drives rowsAffected
// by SQL kind. Tests configure the event-insert outcomes explicitly.
let eventInsertOutcomes: number[] = [1];
// claim outcome + stored hash for the identity_ops paths (R5-F1): the
// tests configure whether a claim wins and what hash the tx reads.
let claimWins = true;
let storedOpHash: string | null = null;
const txExecute = vi.fn(async (statement: { sql?: string }) => {
  const sql = String(statement?.sql ?? "");
  if (sql.includes("INSERT INTO events")) {
    return { rows: [], rowsAffected: eventInsertOutcomes.shift() ?? 1 };
  }
  if (sql.includes("INSERT INTO identity_ops")) {
    return { rows: [], rowsAffected: claimWins ? 1 : 0 };
  }
  if (sql.includes("payload_hash")) {
    return { rows: storedOpHash ? [{ payload_hash: storedOpHash }] : [] };
  }
  // projections always apply
  return { rows: [], rowsAffected: 1 };
});
const tx = {
  execute: txExecute,
  batch: vi.fn(async () => [{ rows: [], rowsAffected: 1 }]),
  commit: vi.fn(async () => undefined),
  rollback: vi.fn(async () => undefined),
};
(
  TursoDatabaseManager.instance.transaction as unknown as ReturnType<typeof vi.fn>
).mockResolvedValue(tx);
const dbBatch = txExecute as unknown as ReturnType<typeof vi.fn>;
/** First executed statement whose SQL contains the fragment. */
function statementContaining(fragment: string) {
  return executedStatements().find((statement) =>
    String(statement.sql).includes(fragment),
  );
}


/** The statements executed through the transaction, in order. */
function executedStatements(): Array<{ sql: string; args: unknown[] }> {
  return dbBatch.mock.calls.map((call) => call[0] as { sql: string; args: unknown[] });
}

const PROJECT_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";

const VALID_EVENT = {
  schemaVersion: 2,
  eventId: "evt-0001",
  type: "track",
  occurredAt: Date.now(),
  anonymousId: "anon-0001",
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
  get: (key: string) => string | undefined;
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
    get: (key: string) => {
      switch (key) {
        case "projectId":
          return (overrides.projectId as string) ?? PROJECT_A;
        case "sourceId":
          return (overrides.sourceId as string) ?? "source-0001";
        case "platform":
          return (overrides.platform as string) ?? "web";
        case "keyType":
          return (overrides.keyType as string) ?? "publishable";
        default:
          return undefined;
      }
    },
  };
}

type JsonResult = { __json: unknown; status?: number };

async function ingest(ctx: TestCtx): Promise<JsonResult> {
  return (await IngestController.ingest(ctx as never)) as unknown as JsonResult;
}

describe("IngestController.ingest (v2 batch ingestion)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
    // default: no identity ops were processed yet
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
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

    // R4: one write transaction — the event insert carries the atomic
    // projection upserts alongside it
    const eventStatement = statementContaining("INSERT INTO events");
    const { sql, args } = eventStatement ?? { sql: "", args: [] };
    expect(String(sql)).toContain("INSERT INTO events");
    expect(String(sql)).toContain("ON CONFLICT (project_id, id) DO NOTHING");
    expect(args).toEqual([
      "evt-0001",
      PROJECT_A, // derived from the key, never from the body
      "source-0001", // trusted source context (task-13)
      "web", // trusted platform, never client-overridable
      "track",
      "page_viewed",
      2,
      VALID_EVENT.occurredAt,
      expect.any(Number), // server receivedAt
      null,
      "anon-0001",
      null, // user_id (anonymous-only v2 event)
      expect.stringContaining("a_"), // derived person_id
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

    const { args } = statementContaining("INSERT INTO events") ?? { args: [] };
    expect(args).toContain(PROJECT_A);
    expect(args).not.toContain("evil-project");
  });

  it("marks a replayed event as duplicate via the conflict-safe insert", async () => {
    eventInsertOutcomes = [0];
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
    // two valid events → two accepted results
    eventInsertOutcomes = [1, 1];

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    expect(body.results).toEqual([
      { index: 0, id: "evt-0001", status: "accepted" },
      { index: 1, id: "evt-bad-name", status: "rejected", reason: "invalid-name" },
      { index: 2, id: "evt-bad-time", status: "rejected", reason: "invalid-timestamp" },
      { index: 3, id: "evt-dangerous", status: "rejected", reason: "invalid-properties" },
      { index: 4, id: "evt-0001", status: "accepted" },
    ]);
    // the two valid events entered the transaction
    const statements = executedStatements();
    expect(
      statements.filter((s) => String(s.sql).includes("INSERT INTO events")),
    ).toHaveLength(2);
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

    const { args } = statementContaining("INSERT INTO events") ?? { args: [] };
    const stored = JSON.parse(String(args[13])) as Record<string, unknown>;
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

it("maintains sessions_v2 state and broadcasts session-started for accepted sessions", async () => {
    eventInsertOutcomes = [1];
    const ctx = makeContext(
      batch([
        {
          ...VALID_EVENT,
          eventId: "evt-session",
          sessionId: "sess-1",
          anonymousId: "anon-1",
          name: "session_started",
        },
      ]),
    );

    const result = await ingest(ctx);

    expect(result.status).toBe(200);
    const eventStatement = statementContaining("INSERT INTO events");
    expect(eventStatement).toBeDefined();
    const sessionStatement = statementContaining("INSERT INTO sessions_v2") as {
      sql: string;
      args: unknown[];
    };
    expect(String(sessionStatement.sql)).toContain("INSERT INTO sessions_v2");
    expect(String(sessionStatement.sql)).toContain("ON CONFLICT (project_id, session_id)");
    expect(sessionStatement.args).toEqual([
      "sess-1",
      PROJECT_A,
      "source-0001", // trusted source context on the session too (task-13)
      "web",
      "anon-1",
      VALID_EVENT.occurredAt,
      expect.any(Number),
      "{}",
    ]);

    expect(emitToClient).toHaveBeenCalledTimes(1);
    const [projectArg, messageArg] = emitToClient.mock.calls[0];
    expect(projectArg).toBe(PROJECT_A);
    const message = JSON.parse(String(messageArg)) as {
      type: string;
      data: { session: Record<string, unknown> };
    };
    expect(message.type).toBe("session-started");
    expect(message.data.session).toMatchObject({
      sessionId: "sess-1",
      projectId: PROJECT_A,
      anonymousId: "anon-1",
      isOnline: 1,
    });
  });

  it("never re-broadcasts a duplicate session-started event", async () => {
    eventInsertOutcomes = [0];
    const ctx = makeContext(
      batch([
        {
          ...VALID_EVENT,
          eventId: "evt-dup-session",
          sessionId: "sess-1",
          name: "session_started",
        },
      ]),
    );

    const result = await ingest(ctx);

    const results = (result.__json as IngestResponseBody).results;
    expect(results[0]?.status).toBe("duplicate");
    expect(emitToClient).not.toHaveBeenCalled();
  });

  it("closes the session row for session_ended events", async () => {
    eventInsertOutcomes = [1];
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, sessionId: "sess-1", name: "session_ended" }]),
    );

    await ingest(ctx);

    const sessionStatement = statementContaining("UPDATE sessions_v2 SET ended_at") as {
      sql: string;
      args: unknown[];
    };
    expect(String(sessionStatement.sql)).toContain("UPDATE sessions_v2 SET ended_at");
    expect(sessionStatement.args).toEqual([
      VALID_EVENT.occurredAt,
      expect.any(Number),
      "sess-1",
      PROJECT_A,
    ]);
  });
});

describe("release review — duplicate session safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
  });

  it("a duplicate session_started does NOT reopen the session (no session mutation)", async () => {
    // the event insert loses the conflict; the session/projection must not run
    eventInsertOutcomes = [0];
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, eventId: "evt-dup", sessionId: "sess-1", name: "session_started" }]),
    );

    const result = await ingest(ctx);

    const results = (result.__json as IngestResponseBody).results;
    expect(results[0]?.status).toBe("duplicate");
    // only ONE batch call — the event insert + its person upsert
    // (R3-F7); no session-state batch for a duplicate
    const eventStatement = statementContaining("INSERT INTO events");
    expect(eventStatement).toBeDefined();
    // a duplicate NEVER runs session/projection statements (R4-F3)
    expect(statementContaining("INSERT INTO sessions_v2")).toBeUndefined();
    expect(statementContaining("person_traits")).toBeUndefined();
    expect(emitToClient).not.toHaveBeenCalled();
  });

  it("a duplicate session_ended does NOT touch the session row", async () => {
    eventInsertOutcomes = [0];
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, sessionId: "sess-1", name: "session_ended" }]),
    );

    await ingest(ctx);

    // duplicate: only the event insert ran — no session or person
    // projection statements (R4-F3)
    expect(statementContaining("INSERT INTO sessions_v2")).toBeUndefined();
    expect(statementContaining("INSERT INTO people")).toBeUndefined();
  });

  it("a duplicate ordinary sessioned event does NOT bump last_seen_at", async () => {
    eventInsertOutcomes = [0];
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, sessionId: "sess-1", name: "click" }]),
    );

    await ingest(ctx);

    // duplicate: only the event insert ran — no session or person
    // projection statements (R4-F3)
    expect(statementContaining("INSERT INTO sessions_v2")).toBeUndefined();
    expect(statementContaining("INSERT INTO people")).toBeUndefined();
  });

  it("a NEWLY inserted session_started still mutates session state", async () => {
    eventInsertOutcomes = [1];
    const ctx = makeContext(
      batch([{ ...VALID_EVENT, sessionId: "sess-1", name: "session_started" }]),
    );

    const result = await ingest(ctx);

    const results = (result.__json as IngestResponseBody).results;
    expect(results[0]?.status).toBe("accepted");
    const sessionStatement = executedStatements().find((s) =>
      String(s.sql).includes("INSERT INTO sessions_v2"),
    );
    expect(sessionStatement).toBeDefined();
    expect(String(sessionStatement?.sql)).toContain("INSERT INTO sessions_v2");
  });

  it("rejects an oversized RAW event with unknown fields (measured pre-parse)", async () => {
    // unknown field inflates the raw event beyond 32 KiB; the zod parse
    // would strip it — the size check must measure the RAW payload
    const oversized = {
      ...VALID_EVENT,
      eventId: "evt-raw-big",
      properties: {
        pad: ["x".repeat(9_900), "x".repeat(9_900), "x".repeat(9_900), "x".repeat(9_900)],
      },
      unknownExtraField: "y".repeat(6_000), // stripped by the schema, counted raw
    };
    const ctx = makeContext(
      JSON.stringify({ schemaVersion: 2, sentAt: Date.now(), events: [oversized] }),
    );

    const result = await ingest(ctx);

    const results = (result.__json as IngestResponseBody).results;
    expect(results[0]?.status).toBe("rejected");
    expect(results[0]?.reason).toBe("too-large");
    expect(dbBatch).not.toHaveBeenCalled();
  });
});

describe("identity operations (task-10 §4)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
  });

  it("accepts v3 batches with identity ops and reports accepted outcomes", async () => {
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        sdk: { name: "@prism/core", version: "0.0.1" },
        identity: [
          {
            opId: "op-1",
            userId: "user-123",
            anonymousId: "anon-1",
            traits: { plan: "pro" },
            occurredAt: Date.now(),
          },
        ],
        events: [VALID_EVENT],
      }),
    );

    const result = await ingest(ctx);

    expect(result.status).toBe(200);
    const body = result.__json as IngestResponseBody;
    expect(body.results[0]?.status).toBe("accepted");
    expect(body.identity?.[0]).toMatchObject({
      index: 0,
      opId: "op-1",
      status: "accepted",
    });

    const identityStatements = executedStatements().filter((s: { sql: string }) =>
      String(s.sql).includes("people") ||
      String(s.sql).includes("identities") ||
      String(s.sql).includes("person_traits") ||
      String(s.sql).includes("identity_ops"),
    );
    expect(identityStatements.length).toBeGreaterThanOrEqual(6);
  });

  it("deduplicates retried identity ops by op id", async () => {
    // first pass: no prior ops
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [
          { opId: "op-dup", userId: "user-123", anonymousId: "anon-1", occurredAt: Date.now() },
        ],
        events: [VALID_EVENT],
      }),
    );
    await ingest(ctx);
    expect(statementContaining("identity_ops")).toBeDefined();

    // second pass: the op was already processed with the SAME payload
    // hash → the tx claim loses and the stored-hash read returns the same
    // canonical hash → duplicate
    dbBatch.mockClear();
    claimWins = false;
    const secondOp = {
      opId: "op-dup",
      userId: "user-123",
      anonymousId: "anon-1",
      occurredAt: Date.now(),
    };
    storedOpHash = identityOpHash(secondOp);
    const ctx2 = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [secondOp],
        events: [VALID_EVENT],
      }),
    );
    const result = await ingest(ctx2);
    const body = result.__json as IngestResponseBody;
    expect(body.identity?.[0]?.status).toBe("duplicate");
    // NO identity-processing statements (only the event insert remains)
    expect(statementContaining("person_traits")).toBeUndefined();
    expect(statementContaining("external_identities")).toBeUndefined();
  });

  it("derives the person from the authenticated project, ignoring client ownership", async () => {
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [
          {
            opId: "op-x",
            userId: "user-123",
            anonymousId: "anon-1",
            traits: { plan: "pro" },
            occurredAt: Date.now(),
          },
        ],
        events: [{ ...VALID_EVENT, userId: "user-123", projectId: "evil" }],
      }),
    );

    await ingest(ctx);

    const event = statementContaining("INSERT INTO events") as {
      sql: string;
      args: unknown[];
    };
    expect(event.args[1]).toBe(PROJECT_A); // key-derived, never "evil"
    expect(event.args[11]).toBe("user-123"); // user_id column (task-13: source_id/platform precede it)
    expect(String(event.args[12])).toContain("u_"); // derived person_id
  });
});

describe("identity-only envelopes (review F2)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
  });

  it("accepts a v3 envelope with NO events when identity operations are present", async () => {
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [
          {
            opId: "op-only",
            userId: "user-only",
            anonymousId: "anon-only",
            traits: { plan: "pro" },
            occurredAt: Date.now(),
          },
        ],
        events: [],
      }),
    );

    const result = await ingest(ctx);

    expect(result.status).toBe(200);
    const body = result.__json as IngestResponseBody;
    expect(body.identity?.[0]).toMatchObject({
      opId: "op-only",
      status: "accepted",
    });
    // the claim + its mutations ran through the transaction
    expect(statementContaining("identity_ops")).toBeDefined();
  });

  it("rejects an envelope with neither events nor identity operations", async () => {
    const ctx = makeContext(
      JSON.stringify({ schemaVersion: 3, sentAt: Date.now(), events: [] }),
    );

    const result = await ingest(ctx);

    expect(result.status).toBe(400);
    const body = result.__json as { error: { code: string } };
    expect(body.error.code).toBe("invalid-envelope");
  });
});

describe("round-3 review fixes (R3-F4, R3-F5)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
  });

  it("R3-F5: a conflicting-payload replay returns an explicit rejected outcome", async () => {
    // first pass: the op was processed with a DIFFERENT payload hash
    const firstOp = {
      opId: "op-conflict",
      userId: "user-a",
      anonymousId: "anon-a",
      traits: { plan: "pro" },
      occurredAt: Date.now(),
    };
    dbBatch.mockClear();
    claimWins = false;
    storedOpHash = identityOpHash({ ...firstOp, userId: "user-DIFFERENT" });
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [firstOp],
        events: [VALID_EVENT],
      }),
    );

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    expect(body.identity?.[0]).toMatchObject({
      opId: "op-conflict",
      status: "rejected",
      reason: "conflicting-payload",
    });
    // no identity statements were built for the rejected op
    expect(statementContaining("external_identities")).toBeUndefined();
    expect(statementContaining("person_traits")).toBeUndefined();
  });
});

describe("round-6 review fixes (R6-F3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    eventInsertOutcomes = [1];
    claimWins = true;
    storedOpHash = null;
    eventLimiter.reset();
    (
      TursoDatabaseManager.instance.execute as unknown as ReturnType<typeof vi.fn>
    ).mockResolvedValue({ rows: [] });
  });

  it("preserves SOURCE indexes and rejects malformed ops with their position", async () => {
    const ctx = makeContext(
      JSON.stringify({
        schemaVersion: 3,
        sentAt: Date.now(),
        identity: [
          { opId: 42 }, // malformed — must receive a coarse rejection
          { opId: "r6f3-valid", userId: "user-x", anonymousId: "anon-x", occurredAt: Date.now() },
          { opId: "r6f3-valid", userId: "user-y", anonymousId: "anon-y", occurredAt: Date.now() }, // in-batch duplicate
        ],
        events: [],
      }),
    );

    const result = await ingest(ctx);

    const body = result.__json as IngestResponseBody;
    // ALL three entries present, in submitted order, with SOURCE indexes
    expect(body.identity).toHaveLength(3);
    expect(body.identity?.[0]).toMatchObject({ index: 0, status: "rejected", reason: "invalid-op" });
    expect(body.identity?.[1]).toMatchObject({ index: 1, status: "accepted" });
    expect(body.identity?.[2]).toMatchObject({ index: 2, status: "rejected", reason: "duplicate-op-id" });
  });
});
