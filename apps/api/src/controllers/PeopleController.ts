import type { Context } from "hono";
import {
  breakdown,
  deletePerson,
  exportPerson,
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
import type { Project } from "../models/Project";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { deriveStandardEvent } from "../utils/standardEvent";
import { getWorkspaceRole, isAdminRole, type WorkspaceRole } from "../utils/workspaceAuth";
import type { PeopleRange, SourcePlatform } from "@prism-analytics/types";

const PEOPLE_RANGE_DAYS: Record<PeopleRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
};

function resolvePeopleRange(raw: string | undefined, now: number): {
  range: PeopleRange;
  from: number;
  to: number;
} {
  const range: PeopleRange = raw === "7d" || raw === "90d" ? raw : "30d";
  return {
    range,
    from: now - PEOPLE_RANGE_DAYS[range] * 86_400_000,
    to: now,
  };
}

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
  ): Promise<{ project: Project; role: WorkspaceRole } | null> {
    // Task 13: authorization derives the project's Better Auth organization
    // and proves membership on the canonical member table. A valid session
    // from another workspace is a non-member: 404, non-disclosing.
    const user = ctx.get("user");
    if (!user) return null;
    const project = (
      (await DatabaseManager.getInstance(ctx)`SELECT id, organization_id, slug
        FROM projects WHERE slug = ${slug}`) as Array<Project>
    )[0];
    if (!project) return null;
    const role = await getWorkspaceRole(
      ctx,
      user.id,
      String(project.organization_id),
    );
    return role ? { project, role } : null;
  }

  private static store(ctx: Context) {
    return TursoDatabaseManager.getInstance(ctx);
  }

  public static async list(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const cursor = ctx.req.query("cursor");
    const limit = Number(ctx.req.query("limit") ?? "50");
    const searchUserId = ctx.req.query("q");
    const traitKey = ctx.req.query("traitKey");
    const traitValue = ctx.req.query("traitValue");

    const range = resolvePeopleRange(ctx.req.query("range"), Date.now());
    const result = await peopleList(PeopleController.store(ctx), access.project.id, {
      cursor,
      limit: Number.isFinite(limit) ? limit : 50,
      ...range,
      ...(searchUserId ? { searchUserId } : {}),
      ...(traitKey && traitValue ? { searchTrait: { key: traitKey, value: traitValue } } : {}),
    });
    return ctx.json(result);
  }

  public static async detail(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const person = await personDetail(PeopleController.store(ctx), access.project.id, personId);
    if (!person) {
      return ctx.json(new ErrorResponse("person_not_found").toJSON(), 404);
    }
    return ctx.json(person);
  }

  public static async activity(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!(await personExists(PeopleController.store(ctx), access.project.id, personId))) {
      return ctx.json(new ErrorResponse("person_not_found").toJSON(), 404);
    }
    // F14: activity limits are clamped to a documented integer range —
    // negative/fractional/huge values can never make the query unbounded.
    const rawLimit = Number(ctx.req.query("limit") ?? "200");
    const limit =
      Number.isInteger(rawLimit) && rawLimit >= 1 && rawLimit <= 500
        ? rawLimit
        : 200;
    const events = await personActivity(
      PeopleController.store(ctx),
      access.project.id,
      personId,
      limit,
    );
    const sources = (await DatabaseManager.getInstance(ctx)`
      SELECT id, name, platform FROM project_sources
      WHERE project_id = ${access.project.id}`) as Array<{
      id: string;
      name: string;
      platform: string;
    }>;
    const sourceById = new Map(sources.map((source) => [source.id, source]));
    return ctx.json(
      events.map((event) => {
        const source = event.sourceId ? sourceById.get(event.sourceId) : undefined;
        return {
          ...event,
          source: source
            ? {
                id: source.id,
                name: source.name,
                platform: source.platform as SourcePlatform,
                status: "active" as const,
              }
            : null,
          standardEvent: deriveStandardEvent(event.name, event.properties),
        };
      }),
    );
  }

  public static async events(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
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
    const events = await filteredEvents(PeopleController.store(ctx), access.project.id, params);
    return ctx.json(events);
  }

  public static async breakdown(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
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
      access.project.id,
      dimension,
      from ? Number(from) : undefined,
      to ? Number(to) : undefined,
    );
    return ctx.json(result);
  }

  public static async export(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(access.role)) {
      return ctx.json(new ErrorResponse("forbidden").toJSON(), 403);
    }
    const exported = await exportPerson(PeopleController.store(ctx), access.project.id, personId);
    if (!exported) {
      return ctx.json(new ErrorResponse("person_not_found").toJSON(), 404);
    }
    return ctx.json(exported);
  }

  public static async remove(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const personId = ctx.req.param("personId") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    if (!isAdminRole(access.role)) {
      return ctx.json(new ErrorResponse("forbidden").toJSON(), 403);
    }
    // explicit destructive action: confirmation is a contract-level
    // requirement (the dashboard requires a typed confirmation; the API
    // requires the ?confirm=true flag). Idempotent retries are safe.
    const confirmed = ctx.req.query("confirm") === "true";
    if (!confirmed) {
      return ctx.json(new ErrorResponse("confirmation_required").toJSON(), 400);
    }
    const result = await deletePerson(PeopleController.store(ctx), access.project.id, personId);
    return ctx.json({ deleted: result.deleted, personId });
  }

  public static async totals(ctx: Context) {
    const slug = ctx.req.param("slug") ?? "";
    const access = await PeopleController.projectForSlug(ctx, slug);
    if (!access) {
      return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
    }
    const from = ctx.req.query("from");
    const to = ctx.req.query("to");
    const result = await honestTotals(
      PeopleController.store(ctx),
      access.project.id,
      from ? Number(from) : undefined,
      to ? Number(to) : undefined,
    );
    return ctx.json(result);
  }
}
