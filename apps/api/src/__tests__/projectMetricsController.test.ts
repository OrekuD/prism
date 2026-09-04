import { beforeAll, describe, expect, it, vi } from "vitest";
import { createClient, type Client } from "@libsql/client";
import {
  applyPendingMigrations,
  readMigrationFiles,
} from "../../../analytics-api/src/database/migrations";
import { ProjectsController } from "../controllers/ProjectsController";
import {
  verifyQueryContextToken,
  resolveTokenKeyConfig,
} from "../utils/queryContextToken";
import { measureMetrics, clearMetricSnapshotCache } from "../utils/projectMetrics";
import { queryContextFingerprint } from "@prism-analytics/types";
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

  it("never widens an unknown-only source filter to all data (R3-F1, R4-F1)", async () => {
    type Body = {
      queryContextToken: string;
      queryContext: {
        sourceScope: "all" | "selected";
        sourceIds: string[];
        from: number;
        to: number;
        compareFrom: number;
        compareTo: number;
        asOf: number;
      };
      facts: Array<{
        metricId: string;
        value: number | null;
        filters: Record<string, unknown>;
        drilldown: { filters?: Record<string, unknown> };
        queryContext: { sourceScope: "all" | "selected"; sourceIds: string[] };
      }>;
    };
    const call = async (query: Record<string, string>) =>
      (
        (await ProjectsController.getMetrics(ctxFor(USER_ID, query))) as {
          __json?: Body;
          __status?: number;
        }
      ).__json;
    const callMulti = async (
      base: Record<string, string>,
      sourceIds: string[],
    ) => {
      const ctx = ctxFor(USER_ID, base);
      const queries = (ctx as unknown as { req: { queries: unknown } }).req
        .queries as unknown as ReturnType<typeof vi.fn>;
      const baseQueries = queries.getMockImplementation();
      queries.mockImplementation((key: string) => {
        if (key === "sourceId") return sourceIds;
        return baseQueries ? baseQueries(key) : [];
      });
      return (
        (await ProjectsController.getMetrics(ctx)) as {
          __json?: Body;
          __status?: number;
        }
      ).__json;
    };
    // Unknown-only: successful zeros over an explicit empty intersection.
    const narrowed = await call({
      ids: "project.accepted_events",
      range: "7d",
      sourceId: "src_unknown",
    });
    expect(
      narrowed?.facts.find(
        (fact) => fact.metricId === "project.accepted_events",
      )?.value,
    ).toBe(0);
    expect(narrowed?.queryContext.sourceIds).toEqual([]);
    expect(narrowed?.queryContext.sourceScope).toBe("selected");
    const fact = narrowed?.facts.find(
      (entry) => entry.metricId === "project.accepted_events",
    );
    expect(fact?.filters).toMatchObject({ sourceScope: "selected" });
    expect(fact?.drilldown.filters).toMatchObject({
      sourceScope: "selected",
    });
    expect(fact?.queryContext.sourceScope).toBe("selected");
    const verified = await verifyQueryContextToken(
      narrowed?.queryContextToken ?? "",
      {
        keys: { k1: SIGNING_KEY },
        projectId: PROJECT_ID,
        organizationId: ORG_ID,
        allowedSourceIds: [],
      },
    );
    expect(verified.ok).toBe(true);
    if (verified.ok) {
      expect(verified.context.sourceScope).toBe("selected");
      expect(verified.context.sourceIds).toEqual([]);
    }
    // Unfiltered all-scope shares `[]` but never aliases: fingerprints
    // differ and the token scopes differ.
    const unfiltered = await call({
      ids: "project.accepted_events",
      range: "7d",
    });
    expect(unfiltered?.queryContext.sourceScope).toBe("all");
    expect(
      queryContextFingerprint({
        ...(unfiltered?.queryContext as Body["queryContext"]),
        timezone: "UTC",
        definitionVersion: 1,
      } as never),
    ).not.toBe(
      queryContextFingerprint({
        ...(narrowed?.queryContext as Body["queryContext"]),
        timezone: "UTC",
        definitionVersion: 1,
      } as never),
    );
    // Canonical follow-up: reusing the unknown-only token through verify
    // plus a scoped re-measure stays empty, while the all-scope re-measure
    // over the same IDs sees the seeded event.
    if (verified.ok) {
      clearMetricSnapshotCache();
      const window = {
        from: verified.context.from,
        to: verified.context.to,
        compareFrom: verified.context.compareFrom,
        compareTo: verified.context.compareTo,
        asOf: verified.context.asOf,
      };
      const caps = {
        web: true,
        mobile: false,
        server: false,
        errorCollection: { configured: false, observed: false },
        standardEventsObserved: [],
        sources: { total: 1, active: 1, lastReceivedAt: null },
        trafficPolicy: "human" as const,
      };
      const emptyFollowup = await measureMetrics(
        analytics as never,
        PROJECT_ID,
        window,
        {
          sourceScope: verified.context.sourceScope,
          sourceIds: [...verified.context.sourceIds],
        },
        [{ metricId: "project.accepted_events", filters: { sourceIds: [] } }],
        { capabilities: caps, now: verified.context.asOf },
      );
      expect(emptyFollowup[0]?.value).toBe(0);
      const allFollowup = await measureMetrics(
        analytics as never,
        PROJECT_ID,
        window,
        { sourceScope: "all", sourceIds: [] },
        [{ metricId: "project.accepted_events" }],
        { capabilities: caps, now: verified.context.asOf },
      );
      expect(allFollowup[0]?.value).toBe(1);
      clearMetricSnapshotCache();
    }
    // Real repeated query: known-plus-unknown narrows to the known source
    // (not a single-value stand-in).
    const mixed = await callMulti(
      { ids: "project.accepted_events", range: "7d" },
      ["src_web_1", "src_unknown"],
    );
    expect(
      mixed?.facts.find((entry) => entry.metricId === "project.accepted_events")
        ?.value,
    ).toBe(1);
    expect(mixed?.queryContext.sourceScope).toBe("selected");
    expect(mixed?.queryContext.sourceIds).toEqual(["src_web_1"]);
    // Duplicate source IDs fail with the same non-disclosing filter error.
    const dupCtx = ctxFor(USER_ID, {
      ids: "project.accepted_events",
      range: "7d",
    });
    const dupQueries = (dupCtx as unknown as { req: { queries: unknown } })
      .req.queries as unknown as ReturnType<typeof vi.fn>;
    dupQueries.mockImplementation((key: string) =>
      key === "sourceId" ? ["src_web_1", "src_web_1"] : [],
    );
    expect(
      ((await ProjectsController.getMetrics(dupCtx)) as { __status?: number })
        .__status,
    ).toBe(400);
  });

  it("rejects unbounded source requests (R3-F1)", async () => {
    const oversized = ctxFor(USER_ID, {
      ids: "project.accepted_events",
      range: "7d",
      sourceId: "x".repeat(129),
    });
    expect(
      (
        (await ProjectsController.getMetrics(oversized)) as {
          __status?: number;
        }
      ).__status,
    ).toBe(400);
    // 65 repeat sourceId params exceed the 64-source contract maximum.
    const crowded = ctxFor(USER_ID, {
      ids: "project.accepted_events",
      range: "7d",
    });
    const queries = (crowded as unknown as { req: { queries: unknown } }).req
      .queries as unknown as ReturnType<typeof vi.fn>;
    queries.mockImplementation((key: string) =>
      key === "sourceId" ? new Array(65).fill("s") : [],
    );
    expect(
      ((await ProjectsController.getMetrics(crowded)) as { __status?: number })
        .__status,
    ).toBe(400);
  });

  it("scopes error configuration to this project's sources (R3-F2)", async () => {
    type Body = {
      facts: Array<{ metricId: string; value: number | null }>;
    };
    const errorValue = async () =>
      (
        (await ProjectsController.getMetrics(
          ctxFor(USER_ID, { ids: "errors.unresolved_issues", range: "7d" }),
        )) as { __json?: Body }
      ).__json?.facts.find(
        (fact) => fact.metricId === "errors.unresolved_issues",
      )?.value;
    const settings = (sourceId: string, mode: string) =>
      analytics.execute({
        sql: `INSERT INTO source_error_settings
              (source_id, mode, capture_global_errors, breadcrumbs_enabled, sampling_rate, release, updated_at)
              VALUES (?, ?, 0, 0, 100, NULL, ?)`,
        args: [sourceId, mode, Date.now()],
      });
    // A foreign project's opt-in never configures this project.
    await settings("src_foreign", "all");
    expect(await errorValue()).toBeNull();
    // An explicit off on the project's own source also leaves it unconfigured.
    await settings("src_web_1", "off");
    expect(await errorValue()).toBeNull();
    // Enabling the project's own source flips to supported zeros.
    await analytics.execute({
      sql: `UPDATE source_error_settings SET mode = 'manual' WHERE source_id = 'src_web_1'`,
      args: [],
    });
    expect(await errorValue()).toBe(0);
  });

  it("fails closed on blank, short, and invalid signing keys (R4-F3)", async () => {
    const base = { ids: "project.accepted_events", range: "7d" };
    const statusFor = async (env: Record<string, string>) =>
      (
        (await ProjectsController.getMetrics(
          ctxFor(USER_ID, base, "member", env),
        )) as { __status?: number }
      ).__status;
    // Blank key, short secret, and overlong kid all fail closed.
    expect(await statusFor({})).toBe(503);
    expect(await statusFor({ QUERY_CONTEXT_TOKEN_KEY: "" })).toBe(503);
    expect(await statusFor({ QUERY_CONTEXT_TOKEN_KEY: "short" })).toBe(503);
    expect(
      await statusFor({
        QUERY_CONTEXT_TOKEN_KEY: "valid-secret-000000",
        QUERY_CONTEXT_TOKEN_KID: "x".repeat(65),
      }),
    ).toBe(503);
    expect(
      await statusFor({
        QUERY_CONTEXT_TOKEN_KEY: "valid-secret-000000",
        QUERY_CONTEXT_TOKEN_KID: "",
      }),
    ).toBe(503);
    // A valid configuration serves.
    const ok = (await ProjectsController.getMetrics(
      ctxFor(USER_ID, base, "member", {
        QUERY_CONTEXT_TOKEN_KEY: "valid-secret-000000",
      }),
    )) as { __json?: { queryContextToken: string } };
    expect(typeof ok.__json?.queryContextToken).toBe("string");
    // The validated-config resolver enforces the same policy directly.
    expect(() =>
      resolveTokenKeyConfig({ QUERY_CONTEXT_TOKEN_KEY: "short" }),
    ).toThrow();
  });

  describe("verified drill-down scope (R5-F1)", () => {
    async function metricsToken(
      query: Record<string, string>,
    ): Promise<string> {
      const res = (await ProjectsController.getMetrics(
        ctxFor(USER_ID, query),
      )) as { __json?: { queryContextToken: string } };
      const token = res.__json?.queryContextToken;
      if (!token) throw new Error("missing metrics token");
      return token;
    }

    it("serves Events from the verified scope, never URL scope", async () => {
      const at = Date.now() - 500;
      await analytics.execute({
        sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
          received_at, session_id, anonymous_id, user_id, person_id, properties,
          context, sdk_name, sdk_version, source_id, platform)
         VALUES ('e_other_evt', ?, 'track', 'click', 1, ?, ?, 's9', 'a9', NULL, NULL, '{}', NULL, NULL, NULL, 'src_other', 'web')`,
        args: [PROJECT_ID, at, at],
      });
      const emptyToken = await metricsToken({
        ids: "project.accepted_events",
        range: "7d",
        sourceId: "src_unknown",
      });
      const emptyRes = (await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { ctx: emptyToken }),
      )) as { __json?: unknown[] | { events: unknown[] } };
      const emptyEvents = Array.isArray(emptyRes.__json)
        ? emptyRes.__json
        : (emptyRes.__json as { events: unknown[] }).events;
      expect(emptyEvents).toEqual([]);
      const knownToken = await metricsToken({
        ids: "project.accepted_events",
        range: "7d",
        sourceId: "src_web_1",
      });
      const scopedRes = (await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { ctx: knownToken }),
      )) as { __json?: unknown[] | { events: Array<{ sourceId?: string; source?: { id: string } | null }> } };
      const scopedEvents = Array.isArray(scopedRes.__json)
        ? (scopedRes.__json as Array<{ sourceId?: string; source?: { id: string } | null }>)
        : scopedRes.__json?.events ?? [];
      expect(scopedEvents.length).toBeGreaterThan(0);
      for (const event of scopedEvents) {
        const sid = event.sourceId ?? event.source?.id;
        expect(sid).toBe("src_web_1");
      }
      // Hostile URL params cannot widen a verified scope.
      const hostileRes = (await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, {
          ctx: knownToken,
          sourceId: "src_other",
          scope: "selected",
        }),
      )) as { __json?: unknown[] | { events: Array<{ sourceId?: string; source?: { id: string } | null }> } };
      const hostileEvents = Array.isArray(hostileRes.__json)
        ? (hostileRes.__json as Array<{ sourceId?: string; source?: { id: string } | null }>)
        : hostileRes.__json?.events ?? [];
      for (const event of hostileEvents) {
        const sid = event.sourceId ?? event.source?.id;
        expect(sid).toBe("src_web_1");
      }
      // Forged ctx fails closed instead of widening.
      const badRes = (await ProjectsController.getProjectEvents(
        ctxFor(USER_ID, { ctx: "bad.token" }),
      )) as { __status?: number };
      expect(badRes.__status).toBe(400);
    });

    it("serves Web analytics from the verified scope", async () => {
      const at = Date.now() - 500;
      const seedWeb = async (eventId: string, source: string) => {
        await analytics.execute({
          sql: `INSERT INTO events (id, project_id, type, name, schema_version, occurred_at,
            received_at, session_id, anonymous_id, user_id, person_id, properties,
            context, sdk_name, sdk_version, source_id, platform)
           VALUES (?, ?, 'track', '$prism_page_view', 1, ?, ?, 'sw', ?, NULL, NULL, '{}', NULL, NULL, NULL, ?, 'web')`,
          args: [eventId, PROJECT_ID, at, at, `a-${eventId}`, source],
        });
        await analytics.execute({
          sql: `INSERT INTO web_page_views (project_id, event_id, occurred_at, host, path, navigation_type, page_sequence, is_bot)
           VALUES (?, ?, ?, 'example.com', '/a', 'initial', 1, 0)`,
          args: [PROJECT_ID, eventId, at],
        });
      };
      await seedWeb("w_ctx_known", "src_web_1");
      await seedWeb("w_ctx_other", "src_other");
      const emptyToken = await metricsToken({
        ids: "project.accepted_events",
        range: "7d",
        sourceId: "src_unknown",
      });
      const emptyRes = (await ProjectsController.getWebAnalytics(
        ctxFor(USER_ID, { ctx: emptyToken }),
      )) as { __json?: { totals: { pageViews: number } } };
      expect(emptyRes.__json?.totals.pageViews).toBe(0);
      const knownToken = await metricsToken({
        ids: "project.accepted_events",
        range: "7d",
        sourceId: "src_web_1",
      });
      const scopedRes = (await ProjectsController.getWebAnalytics(
        ctxFor(USER_ID, { ctx: knownToken }),
      )) as { __json?: { totals: { pageViews: number } } };
      // Only the verified source counts; src_other cannot leak in.
      expect(scopedRes.__json?.totals.pageViews).toBe(1);
      const badRes = (await ProjectsController.getWebAnalytics(
        ctxFor(USER_ID, { ctx: "bad.token" }),
      )) as { __status?: number };
      expect(badRes.__status).toBe(400);
    });
  });
});
