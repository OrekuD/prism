import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import { ProjectsController } from "../controllers/ProjectsController";
import { verifyQueryContextToken } from "../utils/queryContextToken";
import { ProjectOverviewResourceSchema } from "@prism-analytics/types";
import { makeMockDb, makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));
vi.mock("../managers/TursoDatabaseManager", () => ({
  TursoDatabaseManager: { getInstance: vi.fn() },
}));

import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);
const getTursoInstance = vi.mocked(TursoDatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";
const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SLUG = "alpha";
const SIGNING_KEY = "test-signing-key-for-overview";

let analytics: Client;

function productDb(role: string | null) {
  return makeMockDb((sql) => {
    if (sql.includes("SELECT role FROM member")) {
      return role ? [{ role }] : [];
    }
    if (sql.includes("FROM projects")) {
      return [
        { id: PROJECT_ID, organization_id: ORG_ID, slug: SLUG, name: "Alpha" },
      ];
    }
    if (sql.includes("FROM project_sources")) {
      return [{ id: "src_web_1", platform: "web", active: true }];
    }
    return [];
  });
}

function ctxFor(
  userId: string | null,
  query: Record<string, string | undefined>,
  role: string | null = "member",
  env: Record<string, string> = { QUERY_CONTEXT_TOKEN_KEY: SIGNING_KEY },
) {
  getInstance.mockReturnValue(productDb(role) as never);
  getTursoInstance.mockReturnValue(analytics);
  const ctx = makeCtx(
    { slug: SLUG },
    {},
    userId ? { user: { id: userId } } : {},
    query as Record<string, string>,
  );
  (ctx as unknown as { env: Record<string, string> }).env = env;
  return ctx;
}

beforeAll(async () => {
  analytics = createClient({ url: ":memory:" });
  await applyPendingMigrations(analytics, readMigrationFiles());
  const at = Date.now() - 1000;
  await analytics.execute({
    sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
      received_at, session_id, anonymous_id, user_id, person_id, properties,
      context, sdk_name, sdk_version, source_id, platform)
     VALUES ('e1', ?, 'track', 'click', 1, ?, ?, 's1', 'a1', NULL, NULL, '{}', NULL, NULL, NULL, 'src_web_1', 'web')`,
    args: [PROJECT_ID, at, at],
  });
});

describe("GET /projects/:slug/overview", () => {
  it("requires authentication", async () => {
    const result = (await ProjectsController.getOverview(
      ctxFor(null, { range: "7d" }),
    )) as { __status?: number };
    expect(result.__status).toBe(401);
  });

  it("hides strangers with 404", async () => {
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }, null),
    )) as { __status?: number };
    expect(result.__status).toBe(404);
  });

  it("rejects unbounded ranges with 400", async () => {
    for (const range of ["century", "1y", ""]) {
      const result = (await ProjectsController.getOverview(
        ctxFor(USER_ID, { range }),
      )) as { __status?: number };
      expect(result.__status, range).toBe(400);
    }
  });

  it("returns a schema-valid resource with a verifiable token", async () => {
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }),
    )) as { __json?: Record<string, unknown>; __status?: number };
    expect(result.__status).toBeUndefined();
    const parsed = ProjectOverviewResourceSchema.safeParse(result.__json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data.pulse).toHaveLength(3);
    expect(parsed.data.insights.length).toBeLessThanOrEqual(3);
    const verified = await verifyQueryContextToken(
      parsed.data.queryContextToken,
      {
        keys: { k1: SIGNING_KEY },
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        allowedSourceIds: ["src_web_1"],
      },
    );
    expect(verified.ok).toBe(true);
  });

  it("fails closed with 503 without a signing key", async () => {
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }, "member", {}),
    )) as { __status?: number; __json?: { code?: string } };
    expect(result.__status).toBe(503);
  });

  it("defaults to the 7d range", async () => {
    const result = (await ProjectsController.getOverview(ctxFor(USER_ID, {}))) as {
      __json?: { queryContext?: { from?: number; to?: number } };
      __status?: number;
    };
    expect(result.__status).toBeUndefined();
    const span = (result.__json?.queryContext?.to ?? 0) - (result.__json?.queryContext?.from ?? 0);
    expect(span).toBe(7 * 86_400_000);
  });
});
