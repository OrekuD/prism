/**
 * Database integration tests for the analytics (Turso) API.
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
import { AnalyticsController } from "../../controllers/AnalyticsController.js";
import { IngestController } from "../../controllers/IngestController.js";

config({ path: ".env" });

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" &&
  !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

const PROJECT_ID = "itest-project-00000000-0000-0000-0000-000000000000";

run("analytics database integration", () => {
  it("startSession writes a session that endSession and reads can see", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });

    const cleanup = async () => {
      await client.execute({
        sql: "DELETE FROM sessions WHERE project_id = ?",
        args: [PROJECT_ID],
      });
      client.close();
    };

    try {
      // Ensure the canonical schema exists.
      await client.execute(`
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          session_id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          referrer TEXT, country_code TEXT, os TEXT, browser TEXT,
          location TEXT, is_mobile INTEGER NOT NULL DEFAULT 0,
          ip TEXT, lat TEXT, long TEXT,
          is_online INTEGER NOT NULL DEFAULT 1,
          created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        )`);

      const ctx = {
        req: {
          json: async () => ({
            referrer: "https://itest.example",
            userAgent:
              "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
            location: "Integration",
          }),
          header: () => undefined,
          raw: { headers: new Headers() },
        },
        json: (value: unknown) => ({ __json: value }),
        get: () => PROJECT_ID,
      } as never;

      const start = await AnalyticsController.startSession(ctx);
      const sessionId = (
        start as unknown as { __json: { sessionId: string } }
      ).__json.sessionId;
      expect(sessionId).toBeTruthy();

      // The session is readable with the canonical summary query shape.
      const rows = await client.execute({
        sql: "SELECT session_id, is_online FROM sessions WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      expect(rows.rows.length).toBe(1);
      expect(rows.rows[0].is_online).toBe(1);

      // endSession flips is_online, scoped to the authenticated project.
      const endCtx = {
        req: { json: async () => ({ sessionId }) },
        json: (value: unknown) => ({ __json: value }),
        get: () => PROJECT_ID,
      } as never;
      const end = await AnalyticsController.endSession(endCtx);
      expect(
        (end as unknown as { __json: { message: string } }).__json.message,
      ).toBe("success");

      const after = await client.execute({
        sql: "SELECT is_online FROM sessions WHERE project_id = ? AND session_id = ?",
        args: [PROJECT_ID, sessionId],
      });
      expect(after.rows[0].is_online).toBe(0);
    } finally {
      await cleanup();
    }
  });

  it("a key from another project cannot end this project's session (scoped update)", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });

    const OTHER_PROJECT = "itest-other-00000000-0000-0000-0000-000000000001";
    const sessionId = `itest-session-${Date.now()}`;

    try {
      await client.execute({
        sql: "INSERT INTO sessions (project_id, session_id, is_online) VALUES (?, ?, 1)",
        args: [PROJECT_ID, sessionId],
      });

      // Attacker's key belongs to OTHER_PROJECT; the controller must scope
      // the UPDATE by project_id, so this session stays online.
      const ctx = {
        req: { json: async () => ({ sessionId }) },
        json: (value: unknown) => ({ __json: value }),
        get: () => OTHER_PROJECT,
      } as never;
      await AnalyticsController.endSession(ctx);

      const rows = await client.execute({
        sql: "SELECT is_online FROM sessions WHERE session_id = ?",
        args: [sessionId],
      });
      expect(rows.rows[0].is_online).toBe(1);
    } finally {
      await client.execute({ sql: "DELETE FROM sessions WHERE session_id = ?", args: [sessionId] });
      client.close();
    }
  });

  it("v2 ingest persists events idempotently and scoped to the project", async () => {
    if (!enabled) return;
    const client = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });

    const cleanup = async () => {
      await client.execute({
        sql: "DELETE FROM events WHERE project_id = ?",
        args: [PROJECT_ID],
      });
      client.close();
    };

    try {
      await client.execute(`
        CREATE TABLE IF NOT EXISTS events (
          id TEXT NOT NULL,
          project_id TEXT NOT NULL,
          type TEXT NOT NULL,
          name TEXT,
          schema_version INTEGER NOT NULL,
          occurred_at INTEGER NOT NULL,
          received_at INTEGER NOT NULL,
          session_id TEXT,
          anonymous_id TEXT,
          properties TEXT,
          context TEXT,
          sdk_name TEXT,
          sdk_version TEXT,
          PRIMARY KEY (project_id, id)
        )`);

      const eventId = `itest-ev-${Date.now()}`;
      const body = JSON.stringify({
        schemaVersion: 2,
        sentAt: Date.now(),
        sdk: { name: "@prism/core", version: "0.0.1" },
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
      // factory: each ingest consumes the request stream — the replay
      // must get a FRESH ctx with a fresh body stream
      const makeCtx = (projectId: string) => ({
        req: {
          header: (name: string) =>
            name.toLowerCase() === "content-type"
              ? "application/json"
              : String(body.length),
          raw: {
            body: new ReadableStream({
              start(controller) {
                controller.enqueue(new TextEncoder().encode(body));
                controller.close();
              },
            }),
          },
        },
        header: () => undefined,
        json: (value: unknown, status?: number) => ({ __json: value, status }),
        get: () => projectId,
      }) as never;

      const ctx = makeCtx(PROJECT_ID);

      const first = (await IngestController.ingest(ctx)) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      expect(first.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);

      // replayed transport retry → duplicate, not a second row
      const second = (await IngestController.ingest(makeCtx(PROJECT_ID))) as unknown as {
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
      expect(row.sdk_name).toBe("@prism/core");
      expect(row.sdk_version).toBe("0.0.1");
      // server-side sanitization applies to direct HTTP clients too
      const stored = JSON.parse(row.properties) as { source: string; password: string };
      expect(stored.source).toBe("itest");
      expect(stored.password).toBe("[REDACTED]");

      // a different project's key cannot see or duplicate this event
      const OTHER = "itest-other-00000000-0000-0000-0000-000000000001";
      const third = (await IngestController.ingest(makeCtx(OTHER))) as unknown as {
        __json: { results: Array<{ status: string }> };
      };
      // same event ID under another project is NOT a duplicate — scoping holds
      expect(third.__json.results).toEqual([
        { index: 0, id: eventId, status: "accepted" },
      ]);

      await client.execute({
        sql: "DELETE FROM events WHERE project_id = ?",
        args: [OTHER],
      });
    } finally {
      await cleanup();
    }
  });
});
