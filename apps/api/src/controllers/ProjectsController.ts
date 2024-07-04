import { Context } from "hono";
import { HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { generateProjectSlug } from "../utils/generateProjectSlug";
import {
  CreateProjectRequest,
  CreateProjectRequestSchema,
  TeamMemberPermissions,
} from "@prism/types";
import { validateData } from "../utils/validateData";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { Team } from "../models/Team";
import { TeamMember } from "../models/TeamMember";
import { OkResponse } from "../network/responses/OkResponse";
import { Project } from "../models/Project";
import { ProjectResponse } from "../network/responses/ProjectResponse";

export class ProjectsController {
  public static async projects(ctx: Context<HonoConfig>) {
    const teamId = ctx.req.param("teamId");

    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 400);
    }

    const user = ctx.get("user")!;

    const db = DatabaseManager.getInstance(ctx);

    const team =
      (await db`SELECT owner_id FROM teams WHERE id = ${teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 400);
    }
    const teamMembers =
      await db`SELECT id FROM team_members WHERE team_id = ${teamId} AND user_id = ${user.id}`;

    if (teamMembers.length === 0 && team[0].owner_id !== user.id) {
      return ctx.json([]); // or return error instead?
    }

    const projects =
      (await db`SELECT id, slug, name FROM projects WHERE team_id = ${teamId}`) as Array<Project>;

    return ctx.json(
      projects.map((project) => new ProjectResponse(project).toJSON()),
    );
  }

  public static async createProject(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<CreateProjectRequest>();

    const data = validateData(CreateProjectRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user")!;

    const db = DatabaseManager.getInstance(ctx);

    const team =
      (await db`SELECT id, owner_id FROM teams WHERE id = ${data.teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }

    const hasPermission = await ProjectsController._hasPermission(ctx, team[0]);

    if (!hasPermission) {
      return ctx.json(new ErrorResponse("no_permission").toJSON(), 400);
    }

    const projectSlug = generateProjectSlug();

    await db`INSERT INTO projects (name, team_id, creator_id, project_slug) VALUES (${data.name}, ${data.teamId}, ${user.id}, ${projectSlug})`;

    return ctx.json(new OkResponse().toJSON());
  }

  public static async deleteProject(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const db = DatabaseManager.getInstance(ctx);

    return ctx.json("");
  }

  private static async _hasPermission(
    ctx: Context<HonoConfig>,
    team: Team,
  ): Promise<boolean> {
    const user = ctx.get("user")!;

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
