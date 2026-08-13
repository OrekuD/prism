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
  TeamMemberPermissions,
} from "@prism/types";
import { validateData } from "../utils/validateData";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import type { Team } from "../models/Team";
import type { TeamMember } from "../models/TeamMember";
import { OkResponse } from "../network/responses/OkResponse";
import type { Project } from "../models/Project";
import { ProjectResponse } from "../network/responses/ProjectResponse";
import { ProjectDetailedResponse } from "../network/responses/ProjectDetailedResponse";
import { generateApiKey } from "../utils/generateApiKey";
import { projectAnalytics, projectEvents } from "../utils/analyticsStore";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";

export class ProjectsController {
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

    const team =
      (await db`SELECT id, owner_id FROM teams WHERE id = ${data.teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasAdminPermission(
      ctx,
      team[0],
    );

    if (!hasPermission) {
      return ctx.json(new ErrorResponse("cannot_create_project").toJSON(), 400);
    }

    const projectSlug = generateProjectSlug();

    const project =
      (await db`INSERT INTO projects (name, team_id, creator_id, slug) VALUES (${data.name}, ${data.teamId}, ${user.id}, ${projectSlug}) RETURNING id`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }

    await db`INSERT INTO project_api_keys (team_id, project_id, key) VALUES (${data.teamId}, ${project[0].id}, ${generateApiKey()})`;

    return ctx.json(new OkResponse().toJSON());
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
    const db = DatabaseManager.getInstance(ctx);

    const project =
      (await db`SELECT id, team_id FROM projects WHERE id = ${projectId}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const team =
      (await db`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasAdminPermission(
      ctx,
      team[0],
    );

    if (!hasPermission) {
      return ctx.json(new ErrorResponse("cannot_delete_project").toJSON(), 404);
    }

    await db`DELETE FROM projects WHERE id = ${projectId}`;

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

    const project =
      (await DatabaseManager.getInstance(
        ctx,
      )`SELECT id, team_id FROM projects WHERE id = ${projectId}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const team =
      (await DatabaseManager.getInstance(
        ctx,
      )`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasAdminPermission(
      ctx,
      team[0],
    );
    if (!hasPermission) {
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

    const project = (await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.team_id as team_id,
        projects.slug as slug
      FROM projects
      WHERE projects.slug = ${slug}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasPermission(
      ctx,
      project[0].team_id,
    );

    if (!hasPermission) {
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

    const project = (await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.name as name,
        projects.team_id as team_id,
        projects.slug as slug,
        project_api_keys.key as api_key
      FROM projects
      LEFT JOIN project_api_keys
      ON projects.id = project_api_keys.project_id
      WHERE projects.slug = ${slug}`) as Array<Project>;

    if (project.length === 0) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasPermission(
      ctx,
      project[0].team_id,
    );

    if (!hasPermission) {
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

  private static async _hasPermission(
    ctx: Context<HonoConfig>,
    teamId: string,
  ): Promise<boolean> {
    const user = ctx.get("user");
    if (!user) {
      return false;
    }

    const team = (await DatabaseManager.getInstance(
      ctx,
    )`SELECT owner_id, id FROM teams WHERE id = ${teamId}`) as Array<Team>;

    if (team.length === 0) {
      return false;
    }

    if (user.id === team[0].owner_id) {
      return true;
    }

    const teamMember = (await DatabaseManager.getInstance(
      ctx,
    )`SELECT id FROM team_members WHERE user_id = ${user.id} AND team_id = ${team[0].id}`) as Array<TeamMember>;

    if (teamMember.length === 0) {
      return false;
    }

    return true;
  }

  private static async _hasAdminPermission(
    ctx: Context<HonoConfig>,
    team: Team,
  ): Promise<boolean> {
    const user = ctx.get("user");
    if (!user) {
      return false;
    }

    if (user.id === team.owner_id) {
      return true;
    }

    const teamMember = (await DatabaseManager.getInstance(
      ctx,
    )`SELECT permission_id FROM team_members WHERE user_id = ${user.id} AND team_id = ${team.id}`) as Array<TeamMember>;

    if (teamMember.length === 0) {
      return false;
    }

    if (teamMember[0].permission_id === TeamMemberPermissions.ADMIN) {
      return true;
    }

    return false;
  }
}
