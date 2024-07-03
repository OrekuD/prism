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
  JoinTeamRequest,
  JoinTeamRequestSchema,
  SendTeamInvitesRequest,
  SendTeamInvitesRequestSchema,
  TeamInviteJWTPayload,
  TeamMemberPermissions,
} from "@prism/types";
import OkResponse from "../network/responses/OkResponse";
import crypto from "node:crypto";
import MailManager from "../managers/MailManager";
import jwt from "@tsndr/cloudflare-worker-jwt";
import TeamInvite from "../models/TeamInvite";
import { addDays } from "date-fns/addDays";
import TeamInviteResponse from "../network/responses/TeamInviteResponse";
import TeamInviteLinkResponse from "../network/responses/TeamInviteLinkResponse";
import TeamMember from "../models/TeamMember";

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

  public static async getTeamInvite(ctx: Context<HonoConfig>) {
    const token = ctx.req.param("token");
    const db = DatabaseManager.getInstance(ctx);

    if (!token) {
      return ctx.json(new ErrorResponse("token_not_found").toJSON(), 404);
    }

    const isValid = await jwt.verify(token, ctx.env.JWT_SECRET_KEY);

    if (!isValid) {
      return ctx.json(new ErrorResponse("token_invalid").toJSON(), 400);
    }

    const decodedToken = jwt.decode<TeamInviteJWTPayload>(token);

    if (!decodedToken.payload?.teamId) {
      return ctx.json(new ErrorResponse("token_invalid").toJSON(), 400);
    }

    const team = (await db`
        SELECT teams.name as name, team_avatars.image_asset_url as avatar_url
        FROM teams
        LEFT JOIN team_avatars
        ON teams.id = team_avatars.team_id
        WHERE teams.id = ${decodedToken.payload.teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("token_not_found").toJSON(), 404);
    }

    return ctx.json(new TeamInviteResponse(team[0]).toJSON());
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
    const teamId = ctx.req.param("teamId");
    const body = await ctx.req.json<SendTeamInvitesRequest>();

    const data = validateData(SendTeamInvitesRequestSchema, {
      teamId,
      emails: body.emails,
    });

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const db = DatabaseManager.getInstance(ctx);

    const team =
      (await db`SELECT id, is_personal, name FROM teams WHERE id = ${data.teamId} AND is_personal = FALSE AND owner_id = ${user.id}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 401);
    }

    const teamMembers = (await db`
        SELECT
          users.email as email
        FROM team_members
        JOIN users
        ON team_members.user_id = users.id
        WHERE team_members.team_id = ${data.teamId}
        `) as Array<{ email: string }>;

    const pendingInvites =
      await db`SELECT email FROM team_invites WHERE team_id = ${data.teamId} AND status = 'pending'`;

    const pendingInvitesEmails = pendingInvites.map(({ email }) => email);
    const teamMembersEmails = teamMembers.map(({ email }) => email);

    let newTeamMembers = data.emails.filter(
      (value) => !teamMembersEmails.includes(value),
    );

    newTeamMembers = newTeamMembers.filter(
      (value) => !pendingInvitesEmails.includes(value),
    );

    if (newTeamMembers.length === 0) {
      return ctx.json(new OkResponse().toJSON());
    }

    const values = newTeamMembers.map((email) => [
      `${team[0].id}`,
      `${email}`,
      "pending",
    ]);

    const placeholders = values
      .map((_, i) => `($${i * 3 + 1}, $${i * 3 + 2}, $${i * 3 + 3})`)
      .join(", ");

    await db(
      `INSERT INTO team_invites(team_id, email, status) VALUES ${placeholders} RETURNING id;`,
      values.flat(),
    );

    const inviteUrl = await TeamsController._generateInviteUrl(ctx, team[0].id);

    // await MailManager.dispatch(
    //   ctx,
    //   {
    //     name: "team-invite",
    //     props: {
    //       teamName: team[0].name,
    //       teamInviteLink: inviteUrl,
    //     },
    //   },
    //   newTeamMembers,
    // );

    return ctx.json(new OkResponse(inviteUrl).toJSON());
  }

  public static async joinTeam(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;
    const body = await ctx.req.json<JoinTeamRequest>();

    const data = validateData(JoinTeamRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const db = DatabaseManager.getInstance(ctx);

    const team =
      (await db`SELECT id, owner_id FROM teams WHERE id = ${data.teamId}`) as Array<Team>;

    if (team.length === 0) {
      return ctx.json(new ErrorResponse("team_not_found").toJSON(), 404);
    }

    if (team[0].owner_id === user.id) {
      return ctx.json(new ErrorResponse("team_owner").toJSON(), 400);
    }

    const teamMember =
      (await db`SELECT id FROM team_members WHERE user_id = ${user.id} AND team_id = ${data.teamId}`) as Array<TeamMember>;

    if (teamMember.length > 0) {
      return ctx.json(new ErrorResponse("already_a_team_member").toJSON(), 400);
    }

    const newTeamMember =
      await db`INSERT INTO team_members (user_id, team_id, permission_id) VALUES (${user.id}, ${data.teamId}, ${TeamMemberPermissions.BASIC}) RETURNING id`;

    if (newTeamMember.length === 0) {
      return ctx.json(new ErrorResponse("db_error").toJSON(), 500);
    }

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

    await db`DELETE FROM teams WHERE id = ${teamId} `;

    return ctx.json(new OkResponse().toJSON());
  }

  public static async getTeamInviteLink(ctx: Context<HonoConfig>) {
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

    const inviteLink = await TeamsController._generateInviteUrl(ctx, teamId);

    return ctx.json(new TeamInviteLinkResponse(inviteLink).toJSON());
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

    return `${ctx.env.CLIENT_URL}/join?token=${jwtToken}`;
  }
}
