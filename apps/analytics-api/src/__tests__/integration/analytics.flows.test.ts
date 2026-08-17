/**
 * Database integration tests for the analytics (Turso) API — v2 only
 * (the v1 routes were removed in task-9 slice 6).
 *
 * OPT-IN: these tests hit the real Turso database and are SKIPPED unless
 * PRISM_RUN_INTEGRATION=1 (with TURSO_DATABASE_URL/TURSO_AUTH_TOKEN pointing
 * at an ISOLATED analytics test database). They never run against the shared
 * development database by default.
 *
 *   PRISM_RUN_INTEGRATION=1 yarn workspace prism-analytics-api test
 *
 * Rows created by this suite are deleted at the end of each test.
 */
import "./../testEnv.js";
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import { IngestController } from "../../controllers/IngestController.js";

config({ path: ".env" });

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" &&
  !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

const PROJECT_ID = "itest-project-00000000-0000-0000-0000-000000000000";
const OTHER_PROJECT = "itest-other-00000000-0000-0000-0000-000000000001";

function streamOf(body: string): ReadableStream<Uint8Array> {
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(body));
      controller.close();
    },
  });
}

function makeCtx(projectId: string, body: string) {
  return {
    req: {
      header: (name: string) =>
        name.toLowerCase() === "content-type"
          ? "application/json"
          : String(body.length),
      raw: { body: streamOf(body) },
    },
    header: () => undefined,
    json: (value: unknown, status?: number) => ({ __json: value, status }),
    get: () => projectId,
  } as never;
}

run("analytics database integration (v2)", () => {
  it("v2 ingest persists events idempotently and scoped to the project", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });

    const cleanup = async () => {
      await client.execute({
        sql: "DELETE FROM events WHERE project_id IN (?, ?)",
        args: [PROJECT_ID, OTHER_PROJECT],
      });
      client.close();
    };

    try {
      const eventId = `itest-ev-${Date.now()}`;
      const body = JSON.stringify({
        schemaVersion: 2,
        sentAt: Date.now(),
        sdk: { name: "@prism-analytics/core", version: "0.0.1" },
        events: [
          {
            schemaVersion: 2,
            eventId,
            type: "track",
            occurredAt: Date.now(),
            name: "integration_flow",
            properties: { source: "itest", password: "hunter2" },
          },
        ],
      });

      const first = (await IngestController.ingest(makeCtx(PROJECT_ID, body))) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      expect(first.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);

      // replayed transport retry → duplicate, not a second row
      const second = (await IngestController.ingest(makeCtx(PROJECT_ID, body))) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      expect(second.__json.results).toEqual([
        { index: 0, id: eventId, status: "duplicate" },
      ]);

      const rows = await client.execute({
        sql: "SELECT id, name, properties, schema_version, sdk_name, sdk_version FROM events WHERE project_id = ? AND id = ?",
        args: [PROJECT_ID, eventId],
      });
      expect(rows.rows.length).toBe(1);
      const row = rows.rows[0] as unknown as {
        name: string;
        properties: string;
        schema_version: number;
        sdk_name: string | null;
        sdk_version: string | null;
      };
      expect(row.name).toBe("integration_flow");
      expect(row.schema_version).toBe(2);
      // SDK identity derived from the batch envelope → explicit columns
      expect(row.sdk_name).toBe("@prism-analytics/core");
      expect(row.sdk_version).toBe("0.0.1");
      // server-side sanitization applies to direct HTTP clients too
      const stored = JSON.parse(row.properties) as { source: string; password: string };
      expect(stored.source).toBe("itest");
      expect(stored.password).toBe("[REDACTED]");

      // a different project's key cannot see or duplicate this event
      const third = (await IngestController.ingest(makeCtx(OTHER_PROJECT, body))) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      expect(third.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);
    } finally {
      await cleanup();
    }
  });

  it("session_started/ended events maintain the sessions_v2 state atomically", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });

    const sessionId = `itest-sess-${Date.now()}`;
    const anonId = `itest-anon-${Date.now()}`;
    const cleanup = async () => {
      await client.execute({
        sql: "DELETE FROM events WHERE project_id = ?",
        args: [PROJECT_ID],
      });
      await client.execute({
        sql: "DELETE FROM sessions_v2 WHERE project_id = ?",
        args: [PROJECT_ID],
      });
      client.close();
    };

    try {
      const startedAt = Date.now() - 5000;
      const startBody = JSON.stringify({
        schemaVersion: 2,
        sentAt: Date.now(),
        sdk: { name: "@prism-analytics/core", version: "0.0.1" },
        events: [
          {
            schemaVersion: 2,
            eventId: `itest-ev-start-${Date.now()}`,
            type: "track",
            occurredAt: startedAt,
            sessionId,
            anonymousId: anonId,
            name: "session_started",
            properties: {},
          },
        ],
      });
      const start = (await IngestController.ingest(makeCtx(PROJECT_ID, startBody))) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      expect(start.__json.results[0]?.status).toBe("accepted");

      const sessionRows = await client.execute({
        sql: "SELECT session_id, anonymous_id, started_at, is_online, ended_at FROM sessions_v2 WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      expect(sessionRows.rows.length).toBe(1);
      const sessionRow = sessionRows.rows[0] as unknown as {
        anonymous_id: string;
        started_at: number;
        is_online: number;
        ended_at: number | null;
      };
      expect(sessionRow.anonymous_id).toBe(anonId);
      expect(sessionRow.started_at).toBe(startedAt);
      expect(sessionRow.is_online).toBe(1);
      expect(sessionRow.ended_at).toBeNull();

      // session_ended closes the row
      const endedAt = Date.now();
      const endBody = JSON.stringify({
        schemaVersion: 2,
        sentAt: Date.now(),
        sdk: { name: "@prism-analytics/core", version: "0.0.1" },
        events: [
          {
            schemaVersion: 2,
            eventId: `itest-ev-end-${Date.now()}`,
            type: "track",
            occurredAt: endedAt,
            sessionId,
            name: "session_ended",
            properties: {},
          },
        ],
      });
      await IngestController.ingest(makeCtx(PROJECT_ID, endBody));

      const closed = await client.execute({
        sql: "SELECT is_online, ended_at FROM sessions_v2 WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      const closedRow = closed.rows[0] as unknown as { is_online: number; ended_at: number };
      expect(closedRow.is_online).toBe(0);
      expect(closedRow.ended_at).toBe(endedAt);
    } finally {
      await cleanup();
    }
  });
});
run("release review — duplicate session replay", () => {
  it("a replayed session_started never reopens an ended session", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });
    const sessionId = `itest-replay-sess-${Date.now()}`;
    const startEventId = `itest-replay-start-${Date.now()}`;
    const makeBody = (eventId: string, name: string) =>
      JSON.stringify({
        schemaVersion: 2,
        sentAt: Date.now(),
        sdk: { name: "@prism-analytics/core", version: "0.0.1" },
        events: [
          {
            schemaVersion: 2,
            eventId,
            type: "track",
            occurredAt: Date.now(),
            sessionId,
            name,
            properties: {},
          },
        ],
      });

    try {
      await IngestController.ingest(
        makeCtx(PROJECT_ID, makeBody(startEventId, "session_started")),
      );
      await IngestController.ingest(
        makeCtx(PROJECT_ID, makeBody(`itest-replay-end-${Date.now()}`, "session_ended")),
      );
      const closed = await client.execute({
        sql: "SELECT is_online FROM sessions_v2 WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      expect((closed.rows[0] as unknown as { is_online: number }).is_online).toBe(0);

      // REPLAY the ORIGINAL start event — the duplicate must change nothing
      const replay = (await IngestController.ingest(
        makeCtx(PROJECT_ID, makeBody(startEventId, "session_started")),
      )) as unknown as { __json: { results: Array<{ status: string }> } };
      expect(replay.__json.results[0]?.status).toBe("duplicate");

      const after = await client.execute({
        sql: "SELECT is_online FROM sessions_v2 WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      expect((after.rows[0] as unknown as { is_online: number }).is_online).toBe(0);
    } finally {
      await client.execute({ sql: "DELETE FROM events WHERE project_id = ?", args: [PROJECT_ID] });
      await client.execute({
        sql: "DELETE FROM sessions_v2 WHERE project_id = ?",
        args: [PROJECT_ID],
      });
      client.close();
    }
  });
});
