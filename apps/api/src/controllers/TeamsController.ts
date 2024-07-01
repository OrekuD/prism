import { Context } from "hono";
import { HonoConfig } from "../types/types";
import validateData from "../utils/validateData";
import DatabaseManager from "../managers/DatabaseManager";
import ErrorResponse from "../network/responses/ErrorResponse";
import TeamResponse from "../network/responses/TeamResponse";
import Team from "../models/Team";
import {
  CreateTeamRequest,
  CreateTeamRequestSchema,
  DeleteTeamRequest,
  DeleteTeamRequestSchema,
  SendTeamInvitesRequest,
  SendTeamInvitesRequestSchema,
  TeamInviteJWTPayload,
} from "@prism/types";
import OkResponse from "../network/responses/OkResponse";
import crypto from "node:crypto";
import MailManager from "../managers/MailManager";
import jwt from "@tsndr/cloudflare-worker-jwt";
import TeamInvite from "../models/TeamInvite";
import { addDays } from "date-fns/addDays";

export default class TeamsController {
  public static async teams(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const db = DatabaseManager.getInstance(ctx);

    const userCreatedTeams = (await db`
        SELECT
          teams.id as id,
          teams.owner_id as owner_id,
          teams.is_personal as is_personal,
          teams.name as name,
          team_avatars.image_asset_url as avatar_url
        FROM teams
        LEFT JOIN team_avatars ON teams.id = team_avatars.team_id
        WHERE owner_id = ${user.id}
        ORDER BY teams.created_at ASC
        `) as Array<Team>;

    // console.log({ userCreatedTeams });

    const userTeams =
      await db`SELECT * FROM team_members LEFT JOIN teams ON team_members.team_id = teams.id WHERE user_id = ${user.id}`;

    // if (teamMember.length === 0) {
    //   return ctx.json(null);
    // }

    // const teams =
    //   (await db`SELECT * FROM teams LEFT JOIN team_avatars ON teams.id = team_avatars.team_id WHERE id = ${teamMember[0].team_id}`) as Array<Team>;

    return ctx.json(
      userCreatedTeams.map((team) => new TeamResponse(team).toJSON()),
    );
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

    if (userTeams.length >= 10) {
      return ctx.json(
        new ErrorResponse("max_number_teams_exceeded").toJSON(),
        400,
      ); // we might change this later
    }

    const team =
      (await db`INSERT INTO teams (owner_id, name, is_personal) VALUES (${user.id}, ${data.name}, FALSE) RETURNING *`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("db_error"), 500);
    }

    // send email?

    return ctx.json(new TeamResponse(team[0]).toJSON());
  }

  public static async sendInvites(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const body = await ctx.req.json<SendTeamInvitesRequest>();

    const data = validateData(SendTeamInvitesRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const db = DatabaseManager.getInstance(ctx);

    const team =
      (await db`SELECT id, is_personal, name FROM teams WHERE id = ${data.teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }

    if (team[0].is_personal) {
      return ctx.json(new ErrorResponse("cannot_invite").toJSON(), 401);
    }

    const teamMembers = (await db`
        SELECT
          users.email as email,
        FROM team_members
        JOIN users
        ON team_members.user_id = users.id
        WHERE team_id = ${data.teamId}
        `) as Array<{ email: string }>;

    const pendingInvites =
      (await db`SELECT email FROM team_invites WHERE team_id = ${data.teamId} AND status = 'pending'`) as Array<TeamInvite>;

    const pendingInvitesEmails = pendingInvites.map(({ email }) => email);
    const teamMembersEmails = teamMembers.map(({ email }) => email);

    // current          // new          // output
    // ["1", "2", "3"], ["3", "4", "6"] => ["4", "6"]
    let newTeamMembers = data.emails.filter(
      (value) => !teamMembersEmails.includes(value),
    );

    newTeamMembers = newTeamMembers.filter(
      (value) => !pendingInvitesEmails.includes(value),
    );

    if (newTeamMembers.length === 0) {
      return ctx.json(new OkResponse().toJSON());
    }

    const values = newTeamMembers
      .map((email) => `(${team[0].id}, ${email}, pending)`)
      .join(",");

    await db`INSERT INTO team_invites (team_id, email, status) VALUES ${values} RETURNING email, id;`;

    const inviteUrl = await TeamsController._generateInviteUrl(ctx, team[0].id);

    console.log({ inviteUrl });

    await MailManager.dispatch(
      ctx,
      {
        name: "team-invite",
        props: {
          teamName: team[0].name,
          teamInviteLink: inviteUrl,
        },
      },
      newTeamMembers,
    );

    return ctx.json(new OkResponse().toJSON());
  }

  public static async deleteTeam(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const teamId = ctx.req.param("teamId");

    if (!teamId) {
      return ctx.json(new ErrorResponse("team_id_not_found").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);

    const team =
      await db`SELECT id FROM teams WHERE id = ${teamId} AND owner_id = ${user.id} AND is_personal = FALSE`;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }

    await db`DELETE FROM teams WHERE id = ${teamId}`;

    return ctx.json(new OkResponse().toJSON());
  }

  private static async _generateInviteUrl(
    ctx: Context<HonoConfig>,
    teamId: string,
  ) {
    const expiryAt = addDays(new Date(), 14);
    const jwtToken = await jwt.sign<TeamInviteJWTPayload>(
      {
        teamId,
        expiryAt: expiryAt.getTime(),
      },
      ctx.env.JWT_SECRET_KEY,
      {
        algorithm: "HS256",
      },
    );

    return `${ctx.env.CLIENT_URL}/invites?token=${jwtToken}`;
  }
}
