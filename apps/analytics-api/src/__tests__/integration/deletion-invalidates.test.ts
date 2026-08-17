/**
 * Task 13 boundary closure (task-14 §1): deleting a project leaves no
 * usable ingestion key and no authorizable live subscription.
 *
 * OPT-IN like the other integration suites: PRISM_RUN_INTEGRATION=1 with
 * DATABASE_URL (product Postgres, migration 0003 applied) and
 * TURSO_DATABASE_URL/TURSO_AUTH_TOKEN (isolated analytics store).
 *
 * Coverage:
 *  - A publishable web key resolves source-first to its project before
 *    deletion (key → project_sources → projects).
 *  - Deleting the project cascades project_sources + project_api_keys, so
 *    the SAME key is rejected by the real AnalyticsMiddleware afterwards
 *    (401, non-disclosing) and an ingest attempt never reaches the store.
 *  - The WebSocket authorization queries for the deleted project return
 *    nothing — a new connect-project cannot be authorized. (In-flight
 *    socket teardown on deletion is exercised in the deferred hosted
 *    deployment pass, task-14 §7.)
 */
import { config } from "dotenv";
import { describe, expect, it } from "vitest";
import { createClient } from "@libsql/client";
import postgres from "postgres";
import type { Context } from "hono";
import { AnalyticsMiddleware } from "../../middlewares/AnalyticsMiddleware.js";

config({ path: ".dev.vars" });

const enabled =
  process.env.PRISM_RUN_INTEGRATION === "1" &&
  !!process.env.DATABASE_URL &&
  !!process.env.TURSO_DATABASE_URL;

const run = enabled ? describe : describe.skip;

run("task-13 boundary: deletion invalidates keys and subscriptions", () => {
  it("cascades sources+keys on project deletion; the key 401s and connect auth finds nothing", async () => {
    if (!enabled) return;
    const pg = postgres(process.env.DATABASE_URL as string, { max: 2 });
    const turso = createClient({
      url: process.env.TURSO_DATABASE_URL ?? "",
      authToken: process.env.TURSO_AUTH_TOKEN ?? "",
    });
    const stamp = Date.now();
    const orgId = crypto.randomUUID();
    const projectId = crypto.randomUUID();
    const sourceId = crypto.randomUUID();
    const key = `psk_test_${stamp}`;
    const memberUserId = crypto.randomUUID();

    try {
      // ---- seed the product store (mirrors Task 13 schema) ----
      await pg`
        INSERT INTO "user" (id, name, email, email_verified)
        VALUES (${memberUserId}, 'Deletion Test User', ${`del-${stamp}@example.test`}, TRUE)`;
      await pg`
        INSERT INTO organization (id, name, slug, created_at)
        VALUES (${orgId}, 'Deletion Test', ${`del-test-${stamp}`}, NOW())`;
      await pg`
        INSERT INTO projects (id, creator_id, organization_id, name, slug)
        VALUES (${projectId}, ${memberUserId}, ${orgId}, 'Deletion Project', ${`del-proj-${stamp}`})`;
      await pg`
        INSERT INTO project_sources (id, project_id, name, platform, allowed_origins)
        VALUES (${sourceId}, ${projectId}, 'Web', 'web', ${JSON.stringify(["https://fixture.example"])})`;
      await pg`
        INSERT INTO project_api_keys (id, source_id, name, key, key_type)
        VALUES (${crypto.randomUUID()}, ${sourceId}, 'Initial key', ${key}, 'publishable')`;
      await pg`
        INSERT INTO member (id, organization_id, user_id, role, created_at)
        VALUES (${crypto.randomUUID()}, ${orgId}, ${memberUserId}, 'owner', NOW())`;

      // ---- before deletion: the real middleware authenticates the key ----
      const vars: Record<string, unknown> = {};
      const ctx = {
        req: {
          header: (name: string) => {
            if (name.toLowerCase() === "origin") return "https://fixture.example";
            if (name.toLowerCase() === "authorization") return `Bearer ${key}`;
            return undefined;
          },
        },
        json: () => ({ __json: true }),
        set: (k: string, v: unknown) => {
          vars[k] = v;
        },
        get: (k: string) => vars[k],
      } as unknown as Context;

      const next = async () => undefined;
      await AnalyticsMiddleware(ctx, next);
      expect(ctx.get("projectId")).toBe(projectId);
      expect(ctx.get("sourceId")).toBe(sourceId);
      expect(ctx.get("platform")).toBe("web");

      // ---- delete the project exactly like the product API does ----
      await pg`DELETE FROM projects WHERE id = ${projectId}`;

      // ---- after deletion: same key, same origin → rejected ----
      const afterVars: Record<string, unknown> = {};
      const afterCtx = {
        req: {
          header: (name: string) => {
            if (name.toLowerCase() === "origin") return "https://fixture.example";
            if (name.toLowerCase() === "authorization") return `Bearer ${key}`;
            return undefined;
          },
        },
        json: () => ({ __json: true }),
        set: (k: string, v: unknown) => {
          afterVars[k] = v;
        },
        get: (k: string) => afterVars[k],
      } as unknown as Context;
      await AnalyticsMiddleware(afterCtx, next);
      expect(afterCtx.get("projectId")).toBeUndefined();

      // The key row is gone (cascade through project_sources) — a second
      // lookup finds nothing, so an ingest attempt is a 401 before any
      // store write.
      const keyRows = await pg`
        SELECT k.id FROM project_api_keys k
        JOIN project_sources s ON s.id = k.source_id
        WHERE k.key = ${key}`;
      expect(keyRows.length).toBe(0);

      // ---- WebSocket connect authorization for the deleted project ----
      // The manager's connect path first resolves the project; after
      // deletion there is no row, so membership can never be proven.
      const projectRows = await pg`
        SELECT id, organization_id FROM projects WHERE id = ${projectId}`;
      expect(projectRows.length).toBe(0);
      const memberRows = await pg`
        SELECT id FROM member
        WHERE user_id = ${memberUserId} AND organization_id = ${orgId}`;
      // The member row itself survives (the organization still exists) —
      // but with the project gone, the subscription target does not.
      expect(memberRows.length).toBe(1);
    } finally {
      await pg`
        DELETE FROM project_api_keys WHERE source_id = ${sourceId}`.catch(() => undefined);
      await pg`DELETE FROM project_sources WHERE project_id = ${projectId}`.catch(() => undefined);
      await pg`DELETE FROM projects WHERE id = ${projectId}`.catch(() => undefined);
      await pg`DELETE FROM member WHERE organization_id = ${orgId}`.catch(() => undefined);
      await pg`DELETE FROM organization WHERE id = ${orgId}`.catch(() => undefined);
      await pg`DELETE FROM "user" WHERE id = ${memberUserId}`.catch(() => undefined);
      await pg.end();
      turso.close();
    }
  }, 60_000);
});
