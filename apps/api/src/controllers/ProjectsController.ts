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
    const now = Date.now();
    const from = Number(ctx.req.query("from") ?? now - 24 * 60 * 60 * 1000);
    const to = Number(ctx.req.query("to") ?? now);
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
    // error that discloses other workspaces' source existence).
    const requestedSourceIds = (ctx.req.queries("sourceId") ?? []).map((v) =>
      v.slice(0, 64),
    );
    let sourceIds: string[] = [];
    let os: "ios" | "android" | null = null;
    const osParam = ctx.req.query("os");
    if (osParam === "ios" || osParam === "android") os = osParam;
    const release = ctx.req.query("release")?.slice(0, 32) || null;
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

    try {
      // Analytics reads go through the ANALYTICS store (libSQL), never the
      // product Postgres connection used for membership/sources above.
      const resource = await loadMobileAnalytics(ctx, {
        projectId: String(projectRow.id),
        from,
        to,
        sourceIds,
        os,
        release,
      });
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

    const from = Number(ctx.req.query("from"));
    const to = Number(ctx.req.query("to"));
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
    // discloses other workspaces' source existence).
    const requestedSourceIds = (ctx.req.queries("sourceId") ?? []).map((v) =>
      v.slice(0, 64),
    );
    let sourceIds: string[] = [];
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

    const resource = await loadWebAnalytics(
      { projectId, from, to, sourceIds, host, path, traffic },
      Date.now(),
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

    // v2 event listing (task-9 slice 6): bounded query, properties
    // decoded into typed JSON values at this boundary. Task 16 Events UI:
    // trusted source attribution (id/name/platform) is hydrated ONCE per
    // response from the product database — never one query per event.
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
        if (!event.sourceId) return { ...event, source: null };
        const s = byId.get(event.sourceId);
        return {
          ...event,
          source: s ? { id: s.id, name: s.name, platform: s.platform } : null,
        };
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
