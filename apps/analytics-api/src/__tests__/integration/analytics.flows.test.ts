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
});
