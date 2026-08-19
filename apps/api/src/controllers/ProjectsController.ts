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

export class ProjectsController {
  /**
   * Lists the projects of the caller's workspace (Task 13): membership is
   * proven against the canonical member table for the requested
   * organization — never the client's word alone. Any member may list.
   */
  public static async listProjects(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const organizationId = ctx.req.query("organizationId") ?? "";

    if (
      !(await getWorkspaceRole(ctx, user.id, organizationId))
    ) {
      // Non-disclosing: same response for unknown and unauthorized orgs.
      return ctx.json(new ErrorResponse("organization_not_found").toJSON(), 404);
    }

    const db = DatabaseManager.getInstance(ctx);
    const projects = (await db`
      SELECT id, name, slug FROM projects
      WHERE organization_id = ${organizationId}
      ORDER BY created_at ASC`) as Array<{
      id: string;
      name: string;
      slug: string;
    }>;

    const summaries = await dailySessionSummary(
      TursoDatabaseManager.getInstance(ctx),
      projects.map((project) => project.id),
      Date.now() - 7 * 86_400_000,
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
    // decoded into typed JSON values at this boundary.
    const events = await projectEvents(
      TursoDatabaseManager.getInstance(ctx),
      project[0].id,
    );

    return ctx.json(events satisfies Array<EventResource>);
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
