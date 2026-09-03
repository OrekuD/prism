import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import { ProjectsController } from "../controllers/ProjectsController";
import { verifyQueryContextToken } from "../utils/queryContextToken";
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
const STRANGER_ID = "33333333-3333-3333-3333-333333333333";
const ORG_ID = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const PROJECT_ID = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const SLUG = "alpha";
const SIGNING_KEY = "test-signing-key-for-metrics";

let analytics: Client;

function productDb(role: string | null) {
  return makeMockDb((sql) => {
    if (sql.includes("SELECT role FROM member")) {
      return role ? [{ role }] : [];
    }
    if (sql.includes("FROM projects") && sql.includes("WHERE slug")) {
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
  // Seeded relative to real now: the endpoint snapshots at request time.
  const at = Date.now() - 1000;
  await analytics.execute({
    sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
      received_at, session_id, anonymous_id, user_id, person_id, properties,
      context, sdk_name, sdk_version, source_id, platform)
     VALUES ('e1', ?, 'track', 'click', 1, ?, ?, 's1', 'a1', NULL, NULL, '{}', NULL, NULL, NULL, 'src_web_1', 'web')`,
    args: [PROJECT_ID, at, at],
  });
});

describe("GET /projects/:slug/metrics", () => {
  it("requires authentication", async () => {
    const ctx = ctxFor(null, { ids: "project.accepted_events", range: "7d" });
    const result = (await ProjectsController.getMetrics(ctx)) as {
      __status?: number;
    };
    expect(result.__status).toBe(401);
  });

  it("hides unknown projects and strangers with 404", async () => {
    const stranger = ctxFor(
      STRANGER_ID,
      { ids: "project.accepted_events", range: "7d" },
      null,
    );
    expect(
      ((await ProjectsController.getMetrics(stranger)) as { __status?: number })
        .__status,
    ).toBe(404);
    // Missing project: bespoke mock (ctxFor would reset it to the default store).
    getInstance.mockReturnValue(
      makeMockDb((sql) => {
        if (sql.includes("FROM projects")) return [];
        return [];
      }) as never,
    );
    getTursoInstance.mockReturnValue(analytics);
    const missing = makeCtx(
      { slug: SLUG },
      {},
      { user: { id: USER_ID } },
      { ids: "project.accepted_events", range: "7d" },
    );
    (missing as unknown as { env: Record<string, string> }).env = {
      QUERY_CONTEXT_TOKEN_KEY: SIGNING_KEY,
    };
    expect(
      ((await ProjectsController.getMetrics(missing)) as { __status?: number })
        .__status,
    ).toBe(404);
  });

  it("rejects bad ids, ranges, and filters with 400", async () => {
    for (const query of [
      { ids: "funnel.rate", range: "7d" },
      { ids: "", range: "7d" },
      { ids: "project.accepted_events", range: "century" },
      { ids: "standard_event.occurrences", range: "7d" },
      { ids: "project.accepted_events", range: "7d", traffic: "bots" },
    ] as Record<string, string>[]) {
      const ctx = ctxFor(USER_ID, query);
      const result = (await ProjectsController.getMetrics(ctx)) as {
        __status?: number;
      };
      expect(result.__status, JSON.stringify(query)).toBe(400);
    }
  });

  it("returns canonical facts plus a verifiable snapshot token", async () => {
    const ctx = ctxFor(USER_ID, {
      ids: "project.accepted_events,errors.occurrences",
      range: "7d",
    });
    const result = (await ProjectsController.getMetrics(ctx)) as {
      __json?: {
        queryContext: {
          from: number;
          to: number;
          asOf: number;
          sourceIds: string[];
        };
        queryContextToken: string;
        facts: Array<{ id: string; metricId: string; value: number | null }>;
      };
    };
    const body = result.__json;
    expect(
      body?.facts.find((fact) => fact.metricId === "project.accepted_events")
        ?.value,
    ).toBe(1);
    const verified = await verifyQueryContextToken(
      body?.queryContextToken ?? "",
      {
        keys: { k1: SIGNING_KEY },
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        allowedSourceIds: [],
      },
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.context.from).toBe(body?.queryContext.from);
      expect(verified.context.asOf).toBe(body?.queryContext.asOf);
    }
  });

  it("fails closed without a signing key", async () => {
    const ctx = ctxFor(
      USER_ID,
      { ids: "project.accepted_events", range: "7d" },
      "member",
      {},
    );
    const result = (await ProjectsController.getMetrics(ctx)) as {
      __status?: number;
    };
    expect(result.__status).toBe(503);
  });
});
