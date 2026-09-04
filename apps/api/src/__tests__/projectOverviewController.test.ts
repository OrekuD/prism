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
    // Every returned fact carries the structured exact basis (R8-F3).
    for (const fact of [...parsed.data.pulse, ...parsed.data.supportingFacts]) {
      expect(fact.comparisonBasis).toBeDefined();
    }
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

  it("keeps the outcome slot on a range-local zero (R7-F3)", async () => {
    // Observed 100 days ago: outside every v1 range but inside the
    // snapshot. Project-level observation must retain the slot.
    const longAgo = Date.now() - 100 * 86_400_000;
    await analytics.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
        received_at, session_id, anonymous_id, user_id, person_id, properties,
        context, sdk_name, sdk_version, source_id, platform)
       VALUES ('hist-signup', ?, 'track', '$prism_sign_up', 1, ?, ?, 'sh', 'ah', NULL, NULL, ?, NULL, NULL, NULL, 'src_web_1', 'web')`,
      args: [
        PROJECT_ID,
        longAgo,
        longAgo,
        JSON.stringify({ $standard: { schemaVersion: 1, key: "sign_up", data: {} } }),
      ],
    });
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }),
    )) as { __json?: { pulse?: Array<{ metricId?: string; value?: number | null }> }; __status?: number };
    expect(result.__status).toBeUndefined();
    expect(result.__json?.pulse?.[0]?.metricId).toBe("standard_event.occurrences");
    expect(result.__json?.pulse?.[0]?.value).toBe(0);
  });

  it("counts retained events from inactive sources with readiness wording (R7-F4)", async () => {
    const at = Date.now() - 1000;
    await analytics.execute({
      sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
        received_at, session_id, anonymous_id, user_id, person_id, properties,
        context, sdk_name, sdk_version, source_id, platform)
       VALUES ('retained-1', ?, 'track', 'click', 1, ?, ?, 'sr', 'ar', NULL, NULL, '{}', NULL, NULL, NULL, 'src_retired', 'web')`,
      args: [PROJECT_ID, at, at],
    });
    // Override AFTER ctxFor: ctxFor resets the product mock to its default
    // single active source, while this case needs a retired sibling.
    const ctx = ctxFor(USER_ID, { range: "7d" });
    getInstance.mockReturnValue(
      makeMockDb((sql) => {
        if (sql.includes("SELECT role FROM member")) return [{ role: "member" }];
        if (sql.includes("FROM projects")) {
          return [{ id: PROJECT_ID, organization_id: ORG_ID, slug: SLUG, name: "Alpha" }];
        }
        if (sql.includes("FROM project_sources")) {
          return [
            { id: "src_web_1", platform: "web", active: true },
            { id: "src_retired", platform: "web", active: false },
          ];
        }
        return [];
      }) as never,
    );
    getTursoInstance.mockReturnValue(analytics);
    const result = (await ProjectsController.getOverview(ctx)) as {
      __json?: {
        pulse?: Array<{ metricId?: string; value?: number | null }>;
        supportingFacts?: Array<{ metricId?: string; value?: number | null }>;
        dataQuality?: { warnings?: string[] };
      };
      __status?: number;
    };
    expect(result.__status).toBeUndefined();
    const accepted = [
      ...(result.__json?.pulse ?? []),
      ...(result.__json?.supportingFacts ?? []),
    ].find((fact) => fact.metricId === "project.accepted_events");
    // e1 + retained-1 (+ any earlier seeds): the retired source's retained
    // row stays included.
    expect((accepted?.value ?? 0) >= 2).toBe(true);
    expect((result.__json?.dataQuality?.warnings ?? []).join(" ")).toMatch(
      /accept new data/,
    );
    expect((result.__json?.dataQuality?.warnings ?? []).join(" ")).toMatch(
      /remains included/,
    );
  });

  it("parses maximum-length release and title metadata with exact drill-downs (R7-F6)", async () => {
    const longRelease = `rel-${"r".repeat(124)}`;
    expect(longRelease).toHaveLength(128);
    const longTitle = `T${"i".repeat(299)}`;
    await analytics.execute({
      sql: `INSERT INTO error_issues (id, project_id, platform, fingerprint_version, fingerprint, level, status, title, first_seen_at, last_seen_at, occurrence_count, users_affected, first_release, last_release)
       VALUES ('iss-long', ?, 'web', 1, 'fp-long', 'error', 'unresolved', ?, ?, ?, 0, 0, NULL, NULL)`,
      args: [PROJECT_ID, longTitle, Date.now() - 2000, Date.now() - 1000],
    });
    const at = Date.now() - 1000;
    await analytics.execute({
      sql: `INSERT INTO error_occurrences (id, client_event_id, issue_id, project_id, source_id, platform, level, handled, occurred_at, received_at, release, environment, anonymous_id, payload)
       VALUES ('occ-long', 'c-long', 'iss-long', ?, 'src_web_1', 'web', 'error', 0, ?, ?, ?, 'production', 'u-long', '{}')`,
      args: [PROJECT_ID, at, at, longRelease],
    });
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }),
    )) as { __json?: Record<string, unknown>; __status?: number };
    expect(result.__status).toBeUndefined();
    const parsed = ProjectOverviewResourceSchema.safeParse(result.__json);
    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    const releaseInsight = parsed.data.insights.find((insight) => insight.kind === "release");
    expect(releaseInsight).toBeDefined();
    expect(releaseInsight?.id.length).toBeLessThanOrEqual(128);
    const filters = releaseInsight?.drilldown.filters as { release?: string } | undefined;
    expect(filters?.release).toBe(longRelease);
  });

  it("grounds the chart in accepted events, not the pulse head (R7-F7)", async () => {
    const result = (await ProjectsController.getOverview(
      ctxFor(USER_ID, { range: "7d" }),
    )) as {
      __json?: {
        pulse?: Array<{ id?: string; metricId?: string }>;
        supportingFacts?: Array<{ id?: string; metricId?: string }>;
        activity?: { kind?: string; factIds?: string[] };
      };
      __status?: number;
    };
    expect(result.__status).toBeUndefined();
    const facts = [
      ...(result.__json?.pulse ?? []),
      ...(result.__json?.supportingFacts ?? []),
    ];
    const cited = (result.__json?.activity?.factIds ?? [])
      .map((id) => facts.find((fact) => fact.id === id))
      .find((fact) => fact?.metricId === "project.accepted_events");
    expect(cited?.metricId).toBe("project.accepted_events");
  });
});
