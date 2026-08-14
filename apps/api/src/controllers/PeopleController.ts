import type { Context } from "hono";
import {
  breakdown,
  filteredEvents,
  honestTotals,
  peopleList,
  personActivity,
  personDetail,
  personExists,
  type BreakdownDimension,
  type EventFilterParams,
} from "../utils/peopleStore";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import { DatabaseManager } from "../managers/DatabaseManager";
import type { Team } from "../models/Team";
import type { TeamMember } from "../models/TeamMember";
import type { Project } from "../models/Project";
import { ErrorResponse } from "../network/responses/ErrorResponse";

/**
 * People + baseline query APIs (task-10 §5): authenticated,
 * team/project-authorized, bounded, project-scoped reads. Every read is
 * scoped by the project BEFORE filtering or pagination; cursors keep
 * pages bounded; malformed stored JSON is quarantined to null at the
 * boundary (never crashes a response).
 */
export class PeopleController {
  private static async projectForSlug(
    ctx: Context,
    slug: string,
  ): Promise<Project | null> {
    const user = ctx.get("user");
    if (!user) return null;
    const project = (
      (await DatabaseManager.getInstance(ctx)`SELECT id, team_id, slug
        FROM projects WHERE slug = ${slug}`) as Array<Project>
    )[0];
    if (!project) return null;
    const team = (
      (await DatabaseManager.getInstance(ctx)`SELECT owner_id, id FROM teams
        WHERE id = ${project.team_id}`) as Array<Team>
    )[0];
    if (!team) return null;
    if (user.id === team.owner_id) return project;
    const member = (
      (await DatabaseManager.getInstance(ctx)`SELECT id FROM team_members
        WHERE user_id = ${user.id} AND team_id = ${team.id}`) as Array<TeamMember>
    )[0];
    return member ? project : null;
  }

  private static store(ctx: Context) {
    return TursoDatabaseManager.getInstance(ctx);
  }

  public static async list(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const cursor = ctx.req.query("cursor");
    const limit = Number(ctx.req.query("limit") ?? "50");
    const searchUserId = ctx.req.query("q");
    const traitKey = ctx.req.query("traitKey");
    const traitValue = ctx.req.query("traitValue");

    const result = await peopleList(PeopleController.store(ctx), project.id, {
      cursor,
      limit: Number.isFinite(limit) ? limit : 50,
      ...(searchUserId ? { searchUserId } : {}),
      ...(traitKey && traitValue ? { searchTrait: { key: traitKey, value: traitValue } } : {}),
    });
    return ctx.json(result);
  }

  public static async detail(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const person = await personDetail(PeopleController.store(ctx), project.id, personId);
    if (!person) {
      return ctx.json(new ErrorResponse("person_not_found").toJSON(), 404);
    }
    return ctx.json(person);
  }

  public static async activity(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!(await personExists(PeopleController.store(ctx), project.id, personId))) {
      return ctx.json(new ErrorResponse("person_not_found").toJSON(), 404);
    }
    const limit = Number(ctx.req.query("limit") ?? "200");
    const events = await personActivity(
      PeopleController.store(ctx),
      project.id,
      personId,
      Number.isFinite(limit) ? limit : 200,
    );
    return ctx.json(events);
  }

  public static async events(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const query = ctx.req.queries();
    const params: EventFilterParams = {
      from: query.from ? Number(query.from[0]) : undefined,
      to: query.to ? Number(query.to[0]) : undefined,
      name: query.name?.[0],
      personId: query.personId?.[0],
      sessionId: query.sessionId?.[0],
      propertyKey: query.propertyKey?.[0],
      propertyValue: query.propertyValue?.[0],
      limit: query.limit ? Number(query.limit[0]) : undefined,
    };
    const events = await filteredEvents(PeopleController.store(ctx), project.id, params);
    return ctx.json(events);
  }

  public static async breakdown(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const dimension = ctx.req.query("dimension") as BreakdownDimension;
    const supported: BreakdownDimension[] = [
      "event",
      "person",
      "session",
      "context-kind",
      "context-platform",
    ];
    if (!supported.includes(dimension)) {
      return ctx.json(new ErrorResponse("invalid_dimension").toJSON(), 400);
    }
    const from = ctx.req.query("from");
    const to = ctx.req.query("to");
    const result = await breakdown(
      PeopleController.store(ctx),
      project.id,
      dimension,
      from ? Number(from) : undefined,
      to ? Number(to) : undefined,
    );
    return ctx.json(result);
  }

  public static async totals(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const project = await PeopleController.projectForSlug(ctx, slug);
    if (!project) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const from = ctx.req.query("from");
    const to = ctx.req.query("to");
    const result = await honestTotals(
      PeopleController.store(ctx),
      project.id,
      from ? Number(from) : undefined,
      to ? Number(to) : undefined,
    );
    return ctx.json(result);
  }
}
