import type { Context } from "hono";
import { DatabaseTables, type HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { generateProjectSlug } from "../utils/generateProjectSlug";
import {
  type CreateProjectRequest,
  CreateProjectRequestSchema,
  type ProjectDetailedRequest,
  type EventResource,
  type RenameProjectRequest,
  RenameProjectRequestSchema,
} from "@prism-analytics/types";
import { validateData } from "../utils/validateData";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { OkResponse } from "../network/responses/OkResponse";
import type { Project } from "../models/Project";
import { ProjectResponse } from "../network/responses/ProjectResponse";
import { ProjectDetailedResponse } from "../network/responses/ProjectDetailedResponse";
import {
  dailySessionSummary,
  paginatedProjectEvents,
  projectAnalytics,
  projectEvents,
} from "../utils/analyticsStore";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import { purgeProjectErrorData } from "../utils/analyticsErrorPurge";
import {
  getProjectRole,
  getWorkspaceRole,
  isAdminRole,
} from "../utils/workspaceAuth";
import { PAGE_VIEW_LIMITS } from "@prism-analytics/core";
import { loadWebAnalytics } from "../utils/webAnalyticsLoader";
import { loadMobileAnalytics } from "../utils/mobileAnalyticsLoader";
import { deriveStandardEvent } from "../utils/standardEvent";
import {
	executeMobilePurge,
	purgeMobileProjectStatements,
} from "../utils/mobilePurge";
import {
	measureMetrics,
	parseMetricRange,
	resolveMetricWindow,
	resolveProjectCapabilities,
	MetricQueryError,
	type MetricFilters,
} from "../utils/projectMetrics";
import { issueQueryContextToken, resolveTokenKeyConfig, verifyDrilldownToken } from "../utils/queryContextToken";
import {
	METRIC_REGISTRY,
	ProjectMetricsResourceSchema,
	ProjectOverviewResourceSchema,
	StandardEventKeySchema,
	type MetricFact,
} from "@prism-analytics/types";
import { buildOverviewResource } from "../utils/projectOverview";

export class ProjectsController {
  /**
   * Lists the projects of the caller's workspace (Task 13): membership is
   * proven against the canonical member table for the requested
   * organization — never the client's word alone. Any member may list.
   */
  public static async listProjects(ctx: Context<HonoConfig>) {
    const t0 = Date.now();
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const organizationId = ctx.req.query("organizationId") ?? "";

    if (!(await getWorkspaceRole(ctx, user.id, organizationId))) {
      // Non-disclosing: same response for unknown and unauthorized orgs.
      return ctx.json(new ErrorResponse("organization_not_found").toJSON(), 404);
    }

    const tAuth = Date.now();
    const db = DatabaseManager.getInstance(ctx);
    const projects = (await db`
      SELECT id, name, slug FROM projects
      WHERE organization_id = ${organizationId}
      ORDER BY created_at ASC`) as Array<{
      id: string;
      name: string;
      slug: string;
    }>;
    const tPg = Date.now();

    // F9: directory is lightweight by default — sidebar only needs id/name/slug.
    // Summaries are an explicit opt-in for the workspace overview sparkline.
    const includeSummary = ctx.req.query("includeSummary") === "true";
    if (!includeSummary) {
      ctx.header("Server-Timing", `auth;dur=${tAuth - t0}, pg;dur=${tPg - tAuth}`);
      return ctx.json(
        projects.map((project) => ({
          ...project,
          summary: [] as Array<{ date: string; desktop: number; mobile: number }>,
        })),
      );
    }

    const summaries = await dailySessionSummary(
      TursoDatabaseManager.getInstance(ctx),
      projects.map((project) => project.id),
      Date.now() - 7 * 86_400_000,
    );
    const tTurso = Date.now();
    ctx.header(
      "Server-Timing",
      `auth;dur=${tAuth - t0}, pg;dur=${tPg - tAuth}, turso;dur=${tTurso - tPg}`,
    );

    return ctx.json(
      projects.map((project, index) => ({
        ...project,
        summary: summaries[index]?.days ?? [],
      })),
    );
  }

  public static async createProject(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<CreateProjectRequest>();

    const data = validateData(CreateProjectRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);

    // Task 13: the workspace comes from the client ONLY as a target — the
    // authorization is a canonical membership check, never the client's
    // word. Restricted actions (create project) need owner/admin.
    const role = await getWorkspaceRole(ctx, user.id, data.organizationId);
    if (role === null) {
      // Non-disclosing: never reveal whether the workspace exists.
      return ctx.json(new ErrorResponse("cannot_create_project").toJSON(), 400);
    }
    if (!isAdminRole(role)) {
      return ctx.json(new ErrorResponse("cannot_create_project").toJSON(), 400);
    }

    const projectSlug = generateProjectSlug();

    const project =
      (await db`INSERT INTO projects (name, organization_id, creator_id, slug) VALUES (${data.name}, ${data.organizationId}, ${user.id}, ${projectSlug}) RETURNING id`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }

    // Task 13: projects do NOT create ingestion keys — sources do. The
    // Sources page walks the user through the first source + key.
    //
    // The response is the created project (a brand-new project has no
    // sessions yet, so summary is empty) — the client appends it to its
    // project list cache immediately instead of refetching.
    return ctx.json({
      id: project[0]?.id ?? "",
      name: data.name,
      slug: projectSlug,
      summary: [],
    });
  }

  public static async deleteProject(ctx: Context<HonoConfig>) {
    const projectId = ctx.req.param("projectId");

    if (!projectId) {
      return ctx.json(new ErrorResponse("project_id_not_found").toJSON(), 404);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    // Non-disclosing: a missing project and a non-member get the same 404.
    const role = await getProjectRole(ctx, user.id, projectId);
    if (role === null) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(role)) {
      return ctx.json(new ErrorResponse("cannot_delete_project").toJSON(), 404);
    }

    // The project's analytics are removed by the cascade cleanup in the
    // analytics store (project deletion cleans its Turso data): error
    // tracking rows are purged here, in ONE atomic batch, BEFORE the
    // product row is removed — a purge failure fails the deletion closed
    // rather than leaving orphaned diagnostic data behind.
    await purgeProjectErrorData(
      TursoDatabaseManager.getInstance(ctx),
      projectId,
    );
    // Task 17 slice 4: page projections are part of the project-data
    // deletion boundary - removed BEFORE the product row disappears.
    await TursoDatabaseManager.getInstance(ctx).execute({
      sql: "DELETE FROM web_page_views WHERE project_id = ?",
      args: [projectId],
    });
    // Task 18 (R3-F7): mobile telemetry dies with the project in the SAME
    // privacy operation - never deferred to a later retention run.
    await executeMobilePurge(
      TursoDatabaseManager.getInstance(ctx),
      purgeMobileProjectStatements(projectId),
    );
    await DatabaseManager.getInstance(
      ctx,
    )`DELETE FROM projects WHERE id = ${projectId}`;

    return ctx.json(new OkResponse().toJSON());
  }

  public static async renameProject(ctx: Context<HonoConfig>) {
    const projectId = ctx.req.param("projectId");

    if (!projectId) {
      return ctx.json(new ErrorResponse("project_id_not_found").toJSON(), 404);
    }

    const body = await ctx.req.json<RenameProjectRequest>();

    const data = validateData(RenameProjectRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    // Non-member: 404 (non-disclosing). Member without admin: 403.
    const role = await getProjectRole(ctx, user.id, projectId);
    if (role === null) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(role)) {
      return ctx.json(new ErrorResponse("cannot_rename_project").toJSON(), 403);
    }

    const updated =
      (await DatabaseManager.getInstance(
        ctx,
      )`UPDATE projects SET name = ${data.name} WHERE id = ${projectId} RETURNING id, name`) as Array<Project>;

    if (updated.length === 0) {
      return ctx.json(new ErrorResponse("project_not_updated").toJSON(), 400);
    }

    return ctx.json(new OkResponse().toJSON());
  }

  /**
   * GET /projects/:slug/web-analytics (Task 17 slice 5): the bounded,
   * authorized page-analytics read model. Membership is verified through
   * the project exactly like every other read; requested sources must
   * belong to the project AND carry the trusted `web` platform; the range
   * ceiling is the frozen 13 months.
   */
    public static async getMobileAnalytics(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);
    // Same non-disclosing boundary as every project read: resolve the
    // project's organization server-side, then prove membership. The client
    // never supplies a workspace id.
    const projects = (await db`
      SELECT id, organization_id FROM projects WHERE slug = ${slug}`) as Array<{
      id: string;
      organization_id: string;
    }>;
    if (projects.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const projectRow = projects[0];
    if (!projectRow) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const role = await getWorkspaceRole(
      ctx,
      user.id,
      String(projectRow.organization_id),
    );
    if (!role) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    // Range validation (UTC epoch ms, frozen 13-month ceiling).
    // A verified drill-down `ctx` token rebuilds range/cutoff/source from
    // signed state (R5-F1); the `scope` param is never trusted.
    const mobileCtxToken = ctx.req.query("ctx") ?? undefined;
    let mobileCtx: { from: number; to: number; asOf: number; sourceScope: "all" | "selected"; sourceIds: string[] } | null = null;
    if (mobileCtxToken !== undefined) {
      const idRows = (await db`
        SELECT id FROM project_sources WHERE project_id = ${String(projectRow.id)}`) as Array<{
        id: string;
      }>;
      const verified = await verifyDrilldownToken({
        token: mobileCtxToken,
        env: ctx.env,
        projectId: String(projectRow.id),
        organizationId: String(projectRow.organization_id),
        allowedSourceIds: idRows.map((row) => String(row.id)),
      });
      if (!verified.present || !verified.ok) {
        // R6-F5: deployment misconfiguration is an operator 503, never a
        // client filter error; anything else is a non-disclosing 400.
        if (verified.present && !verified.ok && verified.reason === "signing-unavailable") {
          return ctx.json(
            new ErrorResponse("query_context_signing_unavailable").toJSON(),
            503,
          );
        }
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      mobileCtx = {
        from: verified.context.from,
        to: verified.context.to,
        asOf: verified.context.asOf,
        sourceScope: verified.context.sourceScope,
        sourceIds: [...verified.context.sourceIds],
      };
    }
    const now = Date.now();
    const from = mobileCtx !== null ? mobileCtx.from : Number(ctx.req.query("from") ?? now - 24 * 60 * 60 * 1000);
    const to = mobileCtx !== null ? mobileCtx.to : Number(ctx.req.query("to") ?? now);
    const mobileAsOf = mobileCtx !== null ? mobileCtx.asOf : undefined;
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      to <= from ||
      to - from > PAGE_VIEW_LIMITS.maxDashboardRangeMs
    ) {
      return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
    }

    // Repeatable sourceId params - validated against THIS project's React
    // Native sources only; unknown or non-mobile ids are ignored (never an
    // error that discloses other workspaces' source existence). A verified
    // `ctx` scope overrides URL sources (R5-F1).
    let sourceIds: string[] = [];
    let os: "ios" | "android" | null = null;
    const osParam = ctx.req.query("os");
    if (osParam === "ios" || osParam === "android") os = osParam;
    // Release bound aligned with ingestion (R7-F6, max 128): the full
    // identifier travels in filter semantics; only display copy shortens.
    const release = ctx.req.query("release")?.slice(0, 128) || null;
    if (mobileCtx !== null && mobileCtx.sourceScope === "selected") {
      const rows = (await db`
        SELECT id FROM project_sources
        WHERE project_id = ${String(projectRow.id)} AND platform = 'react-native'`) as Array<{
        id: string;
      }>;
      const allowedMobileSources = new Set(rows.map((r) => String(r.id)));
      sourceIds = [...new Set(mobileCtx.sourceIds)].filter((id) =>
        allowedMobileSources.has(id),
      );
      if (sourceIds.length === 0) {
        // Explicitly filtered to nothing applicable -> honest empty payload.
        return ctx.json({
          range: { from, to, timezone: "UTC" },
          filters: { sourceIds: [], os: null, release: null },
          totals: { appOpens: 0, visitors: 0, appSessions: 0, avgScreensPerSession: 0, avgSessionDurationMs: null, observedInstallations: 0, excludedBots: 0 },
          comparison: { appOpens: { kind: "no-prior-data" }, visitors: { kind: "no-prior-data" }, appSessions: { kind: "no-prior-data" }, observedInstallations: { kind: "no-prior-data" } },
          trend: { bucket: "daily", points: [] },
          screens: [],
          releases: [],
          installations: { observed: 0, rows: [] },
          technology: { devices: [], operatingSystems: [], sizeClasses: [], coveragePercent: 0 },
          locations: { countries: [], regions: [], cities: [], coveragePercent: 0 },
          coverage: { technologyPercent: 0, geographyPercent: 0 },
        });
      }
    } else if (mobileCtx === null) {
      const requestedSourceIds = (ctx.req.queries("sourceId") ?? []).map((v) =>
        v.slice(0, 64),
      );
      if (requestedSourceIds.length > 0) {
        const rows = (await db`
          SELECT id FROM project_sources
          WHERE project_id = ${String(projectRow.id)} AND platform = 'react-native'`) as Array<{
          id: string;
        }>;
        const allowedMobileSources = new Set(rows.map((r) => String(r.id)));
        sourceIds = [...new Set(requestedSourceIds)].filter((id) =>
          allowedMobileSources.has(id),
        );
        if (sourceIds.length === 0) {
          // Explicitly filtered to nothing applicable -> honest empty payload.
          return ctx.json({
            range: { from, to, timezone: "UTC" },
            filters: { sourceIds: [], os: null, release: null },
            totals: { appOpens: 0, visitors: 0, appSessions: 0, avgScreensPerSession: 0, avgSessionDurationMs: null, observedInstallations: 0, excludedBots: 0 },
            comparison: { appOpens: { kind: "no-prior-data" }, visitors: { kind: "no-prior-data" }, appSessions: { kind: "no-prior-data" }, observedInstallations: { kind: "no-prior-data" } },
            trend: { bucket: "daily", points: [] },
            screens: [],
            releases: [],
            installations: { observed: 0, rows: [] },
            technology: { devices: [], operatingSystems: [], sizeClasses: [], coveragePercent: 0 },
            locations: { countries: [], regions: [], cities: [], coveragePercent: 0 },
            coverage: { technologyPercent: 0, geographyPercent: 0 },
          });
        }
      }
    }

    try {
      // Analytics reads go through the ANALYTICS store (libSQL), never the
      // product Postgres connection used for membership/sources above.
      const resource = await loadMobileAnalytics(
        TursoDatabaseManager.getInstance(ctx),
        {
          projectId: String(projectRow.id),
          from,
          to,
          sourceIds,
          os,
          release,
          ...(mobileCtx !== null ? { asOf: mobileAsOf } : {}),
        },
      );
      return ctx.json(resource);
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message === "mobile_range_too_large" ||
          error.message === "mobile_range_invalid")
      ) {
        return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
      }
      throw error;
    }
  }

public static async getWebAnalytics(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);
    const projects = (await db`
      SELECT id, organization_id FROM projects WHERE slug = ${slug}`) as Array<{
      id: string;
      organization_id: string;
    }>;
    if (projects.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const projectRow = projects[0];
    if (!projectRow) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const projectId = String(projectRow.id);
    const role = await getWorkspaceRole(ctx, user.id, String(projectRow.organization_id));
    if (!role) {
      // Non-disclosing: same response for missing and unauthorized.
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    // Verified drill-down snapshot (R5-F1): a `ctx` token rebuilds the
    // immutable range, cutoff, and source filter from signed state. The
    // user-controlled `scope` param is never read as authority.
    const webCtxToken = ctx.req.query("ctx") ?? undefined;
    let webCtx: { from: number; to: number; asOf: number; sourceScope: "all" | "selected"; sourceIds: string[] } | null = null;
    if (webCtxToken !== undefined) {
      const idRows = (await db`
        SELECT id FROM project_sources WHERE project_id = ${projectId}`) as Array<{
        id: string;
      }>;
      const verified = await verifyDrilldownToken({
        token: webCtxToken,
        env: ctx.env,
        projectId,
        organizationId: String(projectRow.organization_id),
        allowedSourceIds: idRows.map((row) => String(row.id)),
      });
      if (!verified.present || !verified.ok) {
        if (verified.present && !verified.ok && verified.reason === "signing-unavailable") {
          return ctx.json(
            new ErrorResponse("query_context_signing_unavailable").toJSON(),
            503,
          );
        }
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      webCtx = {
        from: verified.context.from,
        to: verified.context.to,
        asOf: verified.context.asOf,
        sourceScope: verified.context.sourceScope,
        sourceIds: [...verified.context.sourceIds],
      };
    }

    const from = webCtx !== null ? webCtx.from : Number(ctx.req.query("from"));
    const to = webCtx !== null ? webCtx.to : Number(ctx.req.query("to"));
    const webAsOf = webCtx !== null ? webCtx.asOf : Date.now();
    if (
      !Number.isFinite(from) ||
      !Number.isFinite(to) ||
      !Number.isInteger(from) ||
      !Number.isInteger(to) ||
      to <= from
    ) {
      return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
    }
    if (to - from > PAGE_VIEW_LIMITS.maxDashboardRangeMs) {
      // Clear, bounded refusal instead of an unbounded scan.
      return ctx.json(new ErrorResponse("range_too_large").toJSON(), 400);
    }
    const trafficRaw = ctx.req.query("traffic") ?? "human";
    const traffic = trafficRaw === "all" ? "all" : "human";
    const host = (ctx.req.query("host") ?? "").slice(0, 255) || null;
    const path = (ctx.req.query("path") ?? "").slice(0, PAGE_VIEW_LIMITS.maxPathLength) || null;

    // Repeatable sourceId params — validated against THIS project's Web
    // sources only; unknown or non-web ids are ignored (never an error that
    // discloses other workspaces' source existence). A verified `ctx`
    // scope overrides URL sources entirely (R5-F1): `all` means no filter,
    // `selected` narrows to the signed IDs (empty stays empty).
    let sourceIds: string[] = [];
    if (webCtx !== null && webCtx.sourceScope === "selected") {
      const rows = (await db`
        SELECT id FROM project_sources
        WHERE project_id = ${projectId} AND platform = 'web'`) as Array<{ id: string }>;
      const allowedWebSources = new Set(rows.map((r) => String(r.id)));
      sourceIds = [...new Set(webCtx.sourceIds)].filter((id) =>
        allowedWebSources.has(id),
      );
      if (sourceIds.length === 0) {
        // Explicitly filtered to nothing applicable → honest empty payload.
        return ctx.json({
          range: { from, to, timezone: "UTC" },
          filters: {
            sourceIds: [],
            host,
            path,
            traffic,
          },
          totals: {
            pageViews: 0, visitors: 0, sessions: 0,
            viewsPerSession: 0, bounceRate: null, excludedBots: 0,
          },
          comparison: {
            pageViews: { kind: "no-prior-data" },
            visitors: { kind: "no-prior-data" },
            sessions: { kind: "no-prior-data" },
            viewsPerSession: { kind: "no-prior-data" },
            bounceRate: null,
          },
          trend: { bucket: "daily", points: [] },
          pages: [], referrers: [], campaigns: [],
          locations: { countries: [], regions: [], cities: [], coveragePercent: 0 },
          technology: {
            browsers: [], operatingSystems: [], devices: [],
            viewports: [], languages: [], coveragePercent: 0,
          },
          coverage: { technologyPercent: 0, geographyPercent: 0, campaignPercent: 0 },
        });
      }
    } else if (webCtx === null) {
      const requestedSourceIds = (ctx.req.queries("sourceId") ?? []).map((v) =>
        v.slice(0, 64),
      );
      if (requestedSourceIds.length > 0) {
        const rows = (await db`
          SELECT id FROM project_sources
          WHERE project_id = ${projectId} AND platform = 'web'`) as Array<{ id: string }>;
        const allowedWebSources = new Set(rows.map((r) => String(r.id)));
        sourceIds = [...new Set(requestedSourceIds)].filter((id) =>
          allowedWebSources.has(id),
        );
        if (sourceIds.length === 0) {
          // Explicitly filtered to nothing applicable → honest empty payload.
          return ctx.json({
            range: { from, to, timezone: "UTC" },
            filters: {
              sourceIds: [],
              host,
              path,
              traffic,
            },
            totals: {
              pageViews: 0, visitors: 0, sessions: 0,
              viewsPerSession: 0, bounceRate: null, excludedBots: 0,
            },
            comparison: {
              pageViews: { kind: "no-prior-data" },
              visitors: { kind: "no-prior-data" },
              sessions: { kind: "no-prior-data" },
              viewsPerSession: { kind: "no-prior-data" },
              bounceRate: null,
            },
            trend: { bucket: "daily", points: [] },
            pages: [], referrers: [], campaigns: [],
            locations: { countries: [], regions: [], cities: [], coveragePercent: 0 },
            technology: {
              browsers: [], operatingSystems: [], devices: [],
              viewports: [], languages: [], coveragePercent: 0,
            },
            coverage: { technologyPercent: 0, geographyPercent: 0, campaignPercent: 0 },
          });
        }
      }
    }

    const resource = await loadWebAnalytics(
      {
        projectId,
        from,
        to,
        sourceIds,
        host,
        path,
        traffic,
        ...(webCtx !== null ? { asOf: webAsOf } : {}),
      },
      webCtx !== null ? webAsOf : Date.now(),
      TursoDatabaseManager.getInstance(ctx),
    );
    return ctx.json(resource);
  }

  public static async getProjectEvents(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");

    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const project = (await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.organization_id as organization_id,
        projects.slug as slug
      FROM projects
      WHERE projects.slug = ${slug}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    // Read access: any workspace member (owner/admin/member). A valid
    // session from another workspace is a non-member: 404, non-disclosing.
    const role = await getWorkspaceRole(
      ctx,
      user.id,
      String(project[0].organization_id),
    );
    if (!role) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    // v2 event listing: server-paginated + filtered. Query params are the
    // source of truth — search and pagination hit the DB via keyset cursor,
    // not an unbounded in-memory load. Legacy callers with no pagination
    // params still get the bounded array for backwards compat.
    // A verified drill-down `ctx` token overrides range + source filtering
    // (R5-F1): after membership, the signed range/source scope is
    // authoritative and the user-controlled `scope` param is never read.
    const ctxToken = ctx.req.query("ctx") ?? undefined;
    let ctxScope: { sourceScope: "all" | "selected"; sourceIds: string[] } | null = null;
    let ctxRange: { from?: number; to?: number; asOf?: number } = {};
    if (ctxToken !== undefined) {
      const dbForCtx = DatabaseManager.getInstance(ctx);
      const idRows = (await dbForCtx`
        SELECT id FROM project_sources WHERE project_id = ${project[0].id}`) as Array<{
        id: string;
      }>;
      const verified = await verifyDrilldownToken({
        token: ctxToken,
        env: ctx.env,
        projectId: String(project[0].id),
        organizationId: String(project[0].organization_id),
        allowedSourceIds: idRows.map((row) => String(row.id)),
      });
      if (!verified.present || !verified.ok) {
        if (verified.present && !verified.ok && verified.reason === "signing-unavailable") {
          return ctx.json(
            new ErrorResponse("query_context_signing_unavailable").toJSON(),
            503,
          );
        }
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      ctxScope = {
        sourceScope: verified.context.sourceScope,
        sourceIds: [...verified.context.sourceIds],
      };
      ctxRange = {
        from: verified.context.from,
        to: verified.context.to,
        asOf: verified.context.asOf,
      };
    }
    const q = ctx.req.query("q") ?? ctx.req.query("eventName") ?? undefined;
    const cursor = ctx.req.query("cursor") ?? undefined;
    const limitRaw = ctx.req.query("limit");
    // Multi-source URL params stay representable (R5-F1): repeated
    // `sourceId`/`source` values form the URL filter when no verified `ctx`
    // overrides it.
    const urlSourceIds = [
      ...(ctx.req.queries("sourceId") ?? []),
      ...(ctx.req.queries("source") ?? []),
    ].filter((id) => id.length > 0 && id !== "all");
    const sourceId =
      ctxScope !== null
        ? undefined
        : (ctx.req.query("sourceId") ?? ctx.req.query("source") ?? undefined);
    const sourcePlatform = ctx.req.query("sourcePlatform") ?? ctx.req.query("type") ?? undefined;
    // Canonical drill-down range (Task 21 slice 2): optional half-open
    // occurred_at window plus snapshot cutoff. Garbage is a 400, never a
    // silent full scan.
    const parseBoundedInt = (raw: string | undefined): number | undefined => {
      if (raw === undefined) return undefined;
      const value = Number(raw);
      if (!Number.isInteger(value) || value < 0) return Number.NaN;
      return value;
    };
    const drillFrom = ctxScope !== null ? ctxRange.from : parseBoundedInt(ctx.req.query("from"));
    const drillTo = ctxScope !== null ? ctxRange.to : parseBoundedInt(ctx.req.query("to"));
    const drillAsOf = ctxScope !== null ? ctxRange.asOf : parseBoundedInt(ctx.req.query("asOf"));
    if (
      drillFrom !== undefined && Number.isNaN(drillFrom) ||
      drillTo !== undefined && Number.isNaN(drillTo) ||
      drillAsOf !== undefined && Number.isNaN(drillAsOf) ||
      drillFrom !== undefined && drillTo !== undefined && drillTo <= drillFrom
    ) {
      return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
    }
    const hasPagination =
      q !== undefined || cursor !== undefined || limitRaw !== undefined || sourceId !== undefined || urlSourceIds.length > 0 || sourcePlatform !== undefined ||
      drillFrom !== undefined || drillTo !== undefined || drillAsOf !== undefined || ctxScope !== null;

    if (hasPagination) {
      const limit = limitRaw ? Number(limitRaw) : undefined;
      const platformFamily =
        sourcePlatform === "web" || sourcePlatform === "mobile" || sourcePlatform === "server"
          ? (sourcePlatform as "web" | "mobile" | "server")
          : undefined;

      // Verified scope drives the source filter (R5-F1): `all` means no
      // filter, `selected` means exactly the signed IDs (empty stays
      // empty via the loader's authoritative empty-array branch).
      const scopedSourceIds =
        ctxScope !== null
          ? ctxScope.sourceScope === "all"
            ? undefined
            : [...ctxScope.sourceIds]
          : urlSourceIds.length > 1
            ? [...new Set(urlSourceIds)]
            : undefined;
      const scopedSourceId =
        ctxScope !== null
          ? undefined
          : urlSourceIds.length > 1
            ? undefined
            : sourceId && sourceId !== "all"
              ? sourceId
              : undefined;
      const { events, nextCursor } = await paginatedProjectEvents(
        TursoDatabaseManager.getInstance(ctx),
        project[0].id,
        {
          q: q && q.trim().length > 0 ? q : undefined,
          cursor,
          limit: Number.isFinite(limit as number) ? limit : undefined,
          ...(scopedSourceIds !== undefined ? { sourceIds: scopedSourceIds } : {}),
          ...(scopedSourceId !== undefined ? { sourceId: scopedSourceId } : {}),
          platformFamily,
          from: drillFrom,
          to: drillTo,
          asOf: drillAsOf,
        },
      );

      const db = DatabaseManager.getInstance(ctx);
      const sources = (await db`
        SELECT id, name, platform FROM project_sources
        WHERE project_id = ${project[0].id}`) as Array<{
        id: string;
        name: string;
        platform: string;
      }>;
      const byId = new Map(sources.map((s) => [s.id, s]));

      const hydrated = events.map((event) => {
        const standardEvent = deriveStandardEvent(event.name, event.properties);
        if (!event.sourceId) return { ...event, source: null, standardEvent };
        const s = byId.get(event.sourceId);
        return {
          ...event,
          source: s
            ? {
                id: s.id,
                name: s.name,
                platform: s.platform as unknown as import("@prism-analytics/types").SourcePlatform,
                status: "active" as const,
              }
            : null,
          standardEvent,
        };
      });

      if (nextCursor) ctx.header("x-prism-next-cursor", nextCursor);
      // New callers expect { events, nextCursor }; legacy e2e checks Array.isArray.
      const wantsJson = ctx.req.query("format") === "json" || q !== undefined || cursor !== undefined || limitRaw !== undefined;
      if (wantsJson) {
        return ctx.json({ events: hydrated, nextCursor });
      }
      return ctx.json(hydrated);
    }

    // Legacy bounded path (no pagination params) — keep returning a plain array
    // so existing e2e/scripts that do Array.isArray(data) keep passing.
    const events = await projectEvents(
      TursoDatabaseManager.getInstance(ctx),
      project[0].id,
    );

    const db = DatabaseManager.getInstance(ctx);
    const sources = (await db`
      SELECT id, name, platform FROM project_sources
      WHERE project_id = ${project[0].id}`) as Array<{
      id: string;
      name: string;
      platform: string;
    }>;
    const byId = new Map(sources.map((s) => [s.id, s]));

    return ctx.json(
      events.map((event) => {
        const standardEvent = deriveStandardEvent(event.name, event.properties);
        if (!event.sourceId) return { ...event, source: null, standardEvent };
        const s = byId.get(event.sourceId);
        return {
          ...event,
          source: s
            ? {
                id: s.id,
                name: s.name,
                platform: s.platform as unknown as import("@prism-analytics/types").SourcePlatform,
                status: "active" as const,
              }
            : null,
          standardEvent,
        };
      }),
    );
  }

  /**
   * Canonical multi-metric read (Task 21 slice 2): bounded metric IDs over
   * one resolved snapshot. Same non-disclosing project boundary as every
   * project read; query IDs/filters validate against the frozen registry
   * before any analytics query runs.
   */
  public static async getMetrics(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const projects = (await db`
      SELECT id, organization_id FROM projects WHERE slug = ${slug}`) as Array<{
      id: string;
      organization_id: string;
    }>;
    if (projects.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const projectId = String(projects[0].id);
    const organizationId = String(projects[0].organization_id);
    const role = await getWorkspaceRole(ctx, user.id, organizationId);
    if (!role) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const rawIds = [
      ...(ctx.req.queries("id") ?? []),
      ...(ctx.req.query("ids") ?? "").split(","),
    ]
      .map((id) => id.trim())
      .filter((id) => id.length > 0);
    const ids = [...new Set(rawIds)];
    if (ids.length === 0 || ids.length > 27) {
      return ctx.json(new ErrorResponse("invalid_metric").toJSON(), 400);
    }
    const range = parseMetricRange(ctx.req.query("range") ?? "7d");
    if (!range) {
      return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
    }

    // Bounded shared filters; per-metric support is enforced by the
    // service against the registry (unsupported = 400, never silent).
    // Overlong values are rejected, never truncated into a different
    // filter (R3-F1).
    const filters: MetricFilters = {};
    const sourceIdParams = ctx.req.queries("sourceId") ?? [];
    for (const id of sourceIdParams) {
      if (id.length === 0 || id.length > 128) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
    }
    // The 64-source contract maximum applies to the raw request size —
    // before dedupe — so unbounded requests fail deterministically.
    if (sourceIdParams.length > 64) {
      return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
    }
    // R4-F1: duplicate source IDs are a contract violation (the service
    // strict schema rejects them) — fail with the same non-disclosing
    // invalid_filter rather than silently deduping into a different scope.
    if (new Set(sourceIdParams).size !== sourceIdParams.length) {
      return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
    }
    const standardEventKey = ctx.req.query("standardEventKey");
    if (standardEventKey !== undefined) {
      if (!StandardEventKeySchema.safeParse(standardEventKey).success) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.standardEventKey = standardEventKey;
    }
    const traffic = ctx.req.query("traffic");
    if (traffic !== undefined) {
      if (traffic !== "human" && traffic !== "all") {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.traffic = traffic;
    }
    const os = ctx.req.query("os");
    if (os !== undefined) {
      if (os !== "ios" && os !== "android") {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.os = os;
    }
    const release = ctx.req.query("release");
    if (release !== undefined) {
      if (release.length === 0 || release.length > 128) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.release = release;
    }
    const host = ctx.req.query("host");
    if (host !== undefined && host.length > 0) {
      if (host.length > 253) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.host = host;
    }
    const path = ctx.req.query("path");
    if (path !== undefined && path.length > 0) {
      if (path.length > 2048) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.path = path;
    }
    const platform = ctx.req.query("platform");
    if (platform !== undefined) {
      if (
        platform !== "web" &&
        platform !== "ios" &&
        platform !== "android" &&
        platform !== "react-native" &&
        platform !== "server"
      ) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.platform = platform;
    }
    const environment = ctx.req.query("environment");
    if (environment !== undefined) {
      if (environment.length === 0 || environment.length > 64) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.environment = environment;
    }
    const currency = ctx.req.query("currency");
    if (currency !== undefined) {
      if (!/^[A-Z]{3}$/.test(currency)) {
        return ctx.json(new ErrorResponse("invalid_filter").toJSON(), 400);
      }
      filters.currency = currency;
    }

    // Capability inputs: configured sources (+ live keys) from product
    // Postgres; live telemetry from the analytics store. Sequential reads.
    const sourceRows = (await db`
      SELECT s.id AS id, s.platform AS platform,
        COALESCE(BOOL_OR(k.status != 'revoked'), false) AS active
      FROM project_sources s
      LEFT JOIN project_api_keys k ON k.source_id = s.id
      WHERE s.project_id = ${projectId}
      GROUP BY s.id, s.platform`) as Array<{
      id: string;
      platform: string;
      active: boolean;
    }>;
    const knownSourceIds = new Set(sourceRows.map((row) => String(row.id)));
    // Unknown source IDs are ignored (never an existence oracle); an
    // explicit filter to nothing applicable yields honest empty facts.
    // R4-F1: the signed scope distinguishes `all` (no filter) from
    // `selected` (explicit list, possibly empty after narrowing). Both
    // share `sourceIds: []` on the wire for the empty cases — the scope
    // is the only distinction, and follow-ups must enforce it.
    const sourceIds = [...new Set(sourceIdParams)].filter((id) =>
      knownSourceIds.has(id),
    );
    const sourceScope = sourceIdParams.length > 0 ? "selected" : "all";
    const scope = { sourceScope, sourceIds } as const;
    if (sourceIdParams.length > 0) filters.sourceIds = sourceIds;

    const now = Date.now();
    const window = resolveMetricWindow(now, range);
    const analytics = TursoDatabaseManager.getInstance(ctx);
    const telemetry = await analytics.execute({
      sql: `SELECT source_id AS source_id, COUNT(*) AS events,
              MAX(received_at) AS last_received_at
            FROM events WHERE project_id = ? AND source_id IS NOT NULL
            GROUP BY source_id`,
      args: [projectId],
    });
    const telemetryBySource = new Map(
      telemetry.rows.map((row) => [
        String(row.source_id),
        {
          events: Number(row.events ?? 0),
          lastReceivedAt:
            row.last_received_at === null || row.last_received_at === undefined
              ? null
              : Number(row.last_received_at),
        },
      ]),
    );
    // Error-collection intent scoped to THIS project's sources (R3-F2):
    // the settings table is keyed by source_id with no project column, so
    // an unscoped read would let any project's opt-in configure every
    // project. No sources means no configuration (never an `IN ()`).
    const projectSourceIds = sourceRows.map((row) => String(row.id));
    const errorSettings =
      projectSourceIds.length === 0
        ? { rows: [] as Array<Record<string, unknown>> }
        : await analytics.execute({
            sql: `SELECT 1 AS n FROM source_error_settings
                  WHERE mode != 'off'
                    AND source_id IN (${projectSourceIds.map(() => "?").join(",")})
                  LIMIT 1`,
            args: projectSourceIds,
          });
    const errorObserved = await analytics.execute({
      sql: "SELECT 1 AS n FROM error_occurrences WHERE project_id = ? LIMIT 1",
      args: [projectId],
    });
    const standardRows = await analytics.execute({
      // Stable project-level observation (R7-F3): every Standard Event key
      // ever accepted at or before the snapshot cutoff — never inferred
      // from the active display range — so a temporary zero in one range
      // keeps the same pulse slot instead of rearranging the overview.
      sql: `SELECT DISTINCT json_extract(properties, '$."$standard".key') AS k
            FROM events
            WHERE project_id = ? AND received_at <= ? AND name LIKE '$prism_%'`,
      args: [projectId, window.asOf],
    });
    const capabilities = resolveProjectCapabilities({
      sources: sourceRows.map((row) => ({
        platform: String(row.platform),
        active: row.active === true,
        lastReceivedAt: telemetryBySource.get(String(row.id))?.lastReceivedAt ?? null,
      })),
      errorConfigured: errorSettings.rows.length > 0,
      errorObserved: errorObserved.rows.length > 0,
      standardEventsObserved: standardRows.rows.map((row) => String(row.k ?? "")),
    });

    // The human-traffic default applies per metric, only where the
    // registry supports it — a shared default would poison non-web reads.
    // R6-F2: the shared source scope is attached per metric definition.
    // Source-capable metrics receive the authoritative list so the service
    // can enforce scope/filter agreement; other metrics omit it so the
    // service returns the scoped unavailable fact instead of 400ing the
    // whole response. Other user filters stay per-metric and still 400
    // when a single metric doesn't support them.
    let facts: MetricFact[];
    try {
      facts = await measureMetrics(
        analytics,
        projectId,
        window,
        scope,
        ids.map((metricId) => {
          const definition = METRIC_REGISTRY[metricId as keyof typeof METRIC_REGISTRY];
          const scoped: MetricFilters = { ...filters };
          if (
            !(definition &&
              (definition.supportedFilters as readonly string[]).includes("source_ids"))
          ) {
            scoped.sourceIds = undefined;
          }
          if (
            scoped.traffic === undefined &&
            definition &&
            (definition.supportedFilters as readonly string[]).includes("traffic")
          ) {
            scoped.traffic = "human";
          }
          return { metricId, filters: scoped };
        }),
        { capabilities, now },
      );
    } catch (error) {
      if (error instanceof MetricQueryError) {
        const code =
          error.code === "unknown-metric"
            ? "invalid_metric"
            : error.code === "invalid-range"
              ? "invalid_range"
              : "invalid_filter";
        return ctx.json(new ErrorResponse(code).toJSON(), 400);
      }
      throw error;
    }

    // R4-F3: validate the effective key configuration on every request
    // with the same 16-char policy as startup. Blank, short, or
    // overlong kids fail closed with the operator-facing 503 — never an
    // unsigned token, never a one-character HMAC. Only the validated
    // configuration is used; no authorization decision is cached.
    let keyConfig: { kid: string; secret: string };
    try {
      keyConfig = resolveTokenKeyConfig(ctx.env);
    } catch {
      return ctx.json(
        new ErrorResponse("query_context_signing_unavailable").toJSON(),
        503,
      );
    }
    let queryContextToken: string;
    try {
      queryContextToken = await issueQueryContextToken(
        {
          projectId,
          organizationId,
          from: window.from,
          to: window.to,
          compareFrom: window.compareFrom,
          compareTo: window.compareTo,
          asOf: window.asOf,
          sourceScope,
          sourceIds,
        },
        keyConfig,
        window.asOf,
      );
    } catch {
      return ctx.json(
        new ErrorResponse("query_context_signing_unavailable").toJSON(),
        503,
      );
    }
    return ctx.json(
      ProjectMetricsResourceSchema.parse({
        queryContext: {
          from: window.from,
          to: window.to,
          compareFrom: window.compareFrom,
          compareTo: window.compareTo,
          asOf: window.asOf,
          timezone: "UTC",
          sourceScope,
          sourceIds,
          definitionVersion: 1,
        },
        queryContextToken,
        facts,
      }),
    );
  }

  /**
   * Canonical adaptive overview (Task 21 slice 3): deterministic insights,
   * stable pulse, primary activity, and secondary panel over one resolved
   * snapshot. Same non-disclosing project boundary as every project read;
   * range is bounded to the frozen v1 set. v1 serves the all-source scope;
   * per-source overview filtering stays out of scope.
   */
  public static async getOverview(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const db = DatabaseManager.getInstance(ctx);
    const projects = (await db`
      SELECT id, organization_id FROM projects WHERE slug = ${slug}`) as Array<{
      id: string;
      organization_id: string;
    }>;
    if (projects.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const projectId = String(projects[0].id);
    const organizationId = String(projects[0].organization_id);
    const role = await getWorkspaceRole(ctx, user.id, organizationId);
    if (!role) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const range = parseMetricRange(ctx.req.query("range") ?? "7d");
    if (!range) {
      return ctx.json(new ErrorResponse("invalid_range").toJSON(), 400);
    }
    const now = Date.now();
    const window = resolveMetricWindow(now, range);
    const scope = { sourceScope: "all", sourceIds: [] } as const;

    // Capability inputs mirror getMetrics exactly (product Postgres for
    // configured sources/keys; analytics store for live telemetry).
    // Sequential reads only.
    const sourceRows = (await db`
      SELECT s.id AS id, s.platform AS platform,
        COALESCE(BOOL_OR(k.status != 'revoked'), false) AS active
      FROM project_sources s
      LEFT JOIN project_api_keys k ON k.source_id = s.id
      WHERE s.project_id = ${projectId}
      GROUP BY s.id, s.platform`) as Array<{
      id: string;
      platform: string;
      active: boolean;
    }>;
    const analytics = TursoDatabaseManager.getInstance(ctx);
    const telemetry = await analytics.execute({
      sql: `SELECT source_id AS source_id, COUNT(*) AS events,
              MAX(received_at) AS last_received_at
            FROM events WHERE project_id = ? AND source_id IS NOT NULL
            GROUP BY source_id`,
      args: [projectId],
    });
    const telemetryBySource = new Map(
      telemetry.rows.map((row) => [
        String(row.source_id),
        {
          events: Number(row.events ?? 0),
          lastReceivedAt:
            row.last_received_at === null || row.last_received_at === undefined
              ? null
              : Number(row.last_received_at),
        },
      ]),
    );
    const projectSourceIds = sourceRows.map((row) => String(row.id));
    const errorSettings =
      projectSourceIds.length === 0
        ? { rows: [] as Array<Record<string, unknown>> }
        : await analytics.execute({
            sql: `SELECT 1 AS n FROM source_error_settings
                  WHERE mode != 'off'
                    AND source_id IN (${projectSourceIds.map(() => "?").join(",")})
                  LIMIT 1`,
            args: projectSourceIds,
          });
    const errorObserved = await analytics.execute({
      sql: "SELECT 1 AS n FROM error_occurrences WHERE project_id = ? LIMIT 1",
      args: [projectId],
    });
    const standardRows = await analytics.execute({
      // Stable project-level observation (R7-F3): every Standard Event key
      // ever accepted at or before the snapshot cutoff — never inferred
      // from the active display range — so a temporary zero in one range
      // keeps the same pulse slot instead of rearranging the overview.
      sql: `SELECT DISTINCT json_extract(properties, '$."$standard".key') AS k
            FROM events
            WHERE project_id = ? AND received_at <= ? AND name LIKE '$prism_%'`,
      args: [projectId, window.asOf],
    });
    const capabilities = resolveProjectCapabilities({
      sources: sourceRows.map((row) => ({
        platform: String(row.platform),
        active: row.active === true,
        lastReceivedAt: telemetryBySource.get(String(row.id))?.lastReceivedAt ?? null,
      })),
      errorConfigured: errorSettings.rows.length > 0,
      errorObserved: errorObserved.rows.length > 0,
      standardEventsObserved: standardRows.rows.map((row) => String(row.k ?? "")),
    });

    let resource: Awaited<ReturnType<typeof buildOverviewResource>>;
    try {
      resource = await buildOverviewResource({
        client: analytics,
        projectId,
        window,
        scope: { sourceScope: scope.sourceScope, sourceIds: [...scope.sourceIds] },
        capabilities,
        deps: { capabilities, now },
      });
    } catch (error) {
      if (error instanceof MetricQueryError) {
        const code =
          error.code === "invalid-range" ? "invalid_range" : "invalid_filter";
        return ctx.json(new ErrorResponse(code).toJSON(), 400);
      }
      throw error;
    }

    let keyConfig: { kid: string; secret: string };
    try {
      keyConfig = resolveTokenKeyConfig(ctx.env);
    } catch {
      return ctx.json(
        new ErrorResponse("query_context_signing_unavailable").toJSON(),
        503,
      );
    }
    let queryContextToken: string;
    try {
      queryContextToken = await issueQueryContextToken(
        {
          projectId,
          organizationId,
          from: window.from,
          to: window.to,
          compareFrom: window.compareFrom,
          compareTo: window.compareTo,
          asOf: window.asOf,
          sourceScope: scope.sourceScope,
          sourceIds: [...scope.sourceIds],
        },
        keyConfig,
        window.asOf,
      );
    } catch {
      return ctx.json(
        new ErrorResponse("query_context_signing_unavailable").toJSON(),
        503,
      );
    }
    return ctx.json(
      ProjectOverviewResourceSchema.parse({
        ...resource,
        queryContextToken,
      }),
    );
  }

  public static async getProjectBySlug(ctx: Context<HonoConfig>) {
    const slug = ctx.req.param("slug");
    const query = ctx.req.query(
      "duration",
    ) as ProjectDetailedRequest["duration"];

    if (!slug) {
      return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const project = (await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.name as name,
        projects.organization_id as organization_id,
        projects.slug as slug
      FROM projects
      WHERE projects.slug = ${slug}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const role = await getWorkspaceRole(
      ctx,
      user.id,
      String(project[0].organization_id),
    );
    if (!role) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    // v2 bounded aggregates (task-9 slice 6): per-day session counts +
    // device split computed in the database for the requested window.
    // Browser/OS/country rankings have no v2 source and were removed.
    const analytics = await projectAnalytics(
      TursoDatabaseManager.getInstance(ctx),
      project[0].id,
      query,
    );

    return ctx.json(
      new ProjectDetailedResponse(project[0], analytics).toJSON(),
    );
  }
}
