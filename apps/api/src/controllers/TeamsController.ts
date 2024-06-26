import { Context } from "hono";
import { HonoConfig, Roles } from "../types/types";
import validateData from "../utils/validateData";
import DatabaseManager from "../managers/DatabaseManager";
import ErrorResponse from "../network/responses/ErrorResponse";

import TeamResponse from "../network/responses/TeamResponse";
import Team from "../models/Team";
import CreateTeamRequest, {
  CreateTeamRequestSchema,
} from "../network/requests/CreateTeamRequest";

export default class TeamsController {
  public static async team(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const db = DatabaseManager.getInstance(ctx);

    const userTeams =
      (await db`SELECT * FROM teams WHERE owner_id = ${user.id}`) as Array<Team>;

    if (userTeams.length > 0) {
      return ctx.json(new TeamResponse(userTeams[0]).toJSON());
    }

    const teamMember =
      await db`SELECT team_id FROM team_staff_members WHERE user_id = ${user.id}`;

    if (teamMember.length === 0) {
      return ctx.json(null);
    }

    const teams =
      (await db`SELECT * FROM teams WHERE id = ${teamMember[0].team_id}`) as Array<Team>;

    if (teams.length === 0) {
      return ctx.json(null);
    }

    return ctx.json(new TeamResponse(teams[0]).toJSON());
  }

  public static async createTeam(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const body = await ctx.req.json<CreateTeamRequest>();

    const data = validateData(CreateTeamRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const db = DatabaseManager.getInstance(ctx);

    const userTeams =
      (await db`SELECT * FROM teams WHERE owner_id = ${user.id}`) as Array<Team>;

    if (userTeams.length >= 2) {
      return ctx.json(
        new ErrorResponse("max_number_teams_exceeded").toJSON(),
        500,
      ); // we might change this later
    }

    const team =
      (await db`INSERT INTO teams (owner_id, name) VALUES (${user.id}, ${data.name}) RETURNING id, name, created_at, updated_at`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("db_error"), 500);
    }

    // send email?

    return ctx.json(new TeamResponse(team[0]).toJSON());
  }
}
