import type {
	ErrorIssueDetailResource,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueResource,
	ErrorIssueStateRequest,
	ErrorIssueStatus,
} from "@prism-analytics/types";
import type { Context } from "hono";
import { DatabaseManager } from "../managers/DatabaseManager";
import { TursoDatabaseManager } from "../managers/TursoDatabaseManager";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import type { HonoConfig } from "../types/types";
import {
	errorRangeDays,
	issueActivity,
	issueAggregates,
	issueOccurrenceSummaries,
	listProjectIssueResources,
	projectIssueResources,
	updateIssueStatus,
	issueListLimit,
	encodeIssueCursor,
	decodeIssueCursor,
} from "../utils/errorIssuesStore";
import { RateLimiter } from "../utils/RateLimiter";
import { getWorkspaceRole, isAdminRole } from "../utils/workspaceAuth";

/** Management-action soft limit: 60 issue-state changes per user / minute. */
export const issueWorkflowLimiter = new RateLimiter(60_000, 60);

const STATUS_VALUES: ReadonlySet<string> = new Set<ErrorIssueStatus>([
	"unresolved",
	"resolved",
	"ignored",
]);

const LEVEL_VALUES: ReadonlySet<string> = new Set(["error", "warning"]);
const PLATFORM_VALUES: ReadonlySet<string> = new Set([
	"web",
	"ios",
	"android",
	"react-native",
	"server",
]);

/** Coerce an optional raw value to undefined unless it is a known enum. */
function coerce<T extends string>(
	raw: string | undefined,
	allowed: ReadonlySet<string>,
): T | undefined {
	if (raw && allowed.has(raw)) return raw as T;
	return undefined;
}

function clampFilter(value: string | undefined, max = 120): string | undefined {
	if (!value) return undefined;
	const trimmed = value.trim();
	return trimmed.length === 0 ? undefined : trimmed.slice(0, max);
}

/**
 * Error tracking read + workflow API (task-15 slice 2).
 *
 * Permission mapping (frozen in task-15.md): members may read the project's
 * issues; only owner/admin may change issue state (resolve / ignore /
 * reopen). A project the caller cannot read is a non-disclosing 404.
 *
 * The data lives in the analytics (Turso) store — the product API only ever
 * READS from it, matching the two-store architecture.
 */
export class ErrorIssuesController {
	public static async list(ctx: Context<HonoConfig>) {
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
      WHERE projects.slug = ${slug}`) as Array<{
			id: string;
			organization_id: string;
		}>;

		if (project.length === 0) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}

		// Read access: any workspace member. A valid session from another
		// workspace is a non-member: 404, non-disclosing.
		const role = await getWorkspaceRole(
			ctx,
			user.id,
			String(project[0].organization_id),
		);
		if (!role) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}

		const issues = await projectIssueResources(
			TursoDatabaseManager.getInstance(ctx),
			project[0].id,
			{ rangeDays: errorRangeDays(ctx.req.query("range")) },
		);

		return ctx.json(issues satisfies Array<ErrorIssueResource>);
	}

	/**
	 * Paginated, filtered Errors list (task-15): server-side filters +
	 * keyset pagination preserved by the web client in the URL. Invalid or
	 * unknown filter values are coerced to "no filter" (never a leak). The
	 * body stays an array of resources; the next-page cursor rides the
	 * `x-prism-next-cursor` header (non-breaking for existing callers).
	 */
	public static async paginatedList(ctx: Context<HonoConfig>) {
		const slug = ctx.req.param("slug");
		if (!slug) return ctx.json(new ErrorResponse("slug_not_found").toJSON(), 404);
		const user = ctx.get("user");
		if (!user) return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);

		const project = (await DatabaseManager.getInstance(ctx)`
      SELECT
        projects.id as id,
        projects.organization_id as organization_id,
        projects.slug as slug
      FROM projects
      WHERE projects.slug = ${slug}`) as Array<{
			id: string;
			organization_id: string;
		}>;
		if (project.length === 0) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}
		const role = await getWorkspaceRole(
			ctx,
			user.id,
			String(project[0].organization_id),
		);
		if (!role) return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);

		const q = ctx.req.query;
		const status = coerce<ErrorIssueStatus>(q("status"), STATUS_VALUES);
		const level = coerce<ErrorIssueLevel>(
			q("level"),
			LEVEL_VALUES,
		) as ErrorIssueLevel | undefined;
		const platform = coerce<ErrorIssuePlatform>(
			q("platform"),
			PLATFORM_VALUES,
		) as ErrorIssuePlatform | undefined;
		const release = clampFilter(q("release"));
		const search = clampFilter(q("q"));
		const limit = issueListLimit(q("limit"));
		const cursor = decodeIssueCursor(q("cursor"));

		// Resolve the source NAME filter to ids (project_sources lives in the
		// api store; analytics error_occurrences store the source uuid).
		let sourceIds: string[] | undefined;
		const sourceName = clampFilter(q("source"));
		if (sourceName) {
			const sourceRows = (await DatabaseManager.getInstance(ctx)`
        SELECT id FROM project_sources
        WHERE project_id = ${project[0].id} AND name = ${sourceName}
        LIMIT 50`) as Array<{ id: string }>;
			sourceIds = sourceRows.map((row) => String(row.id));
			if (sourceIds.length === 0) {
				// A source name that matches nothing in this project: empty page.
				return ctx.json([] satisfies Array<ErrorIssueResource>);
			}
		}

		const page = await listProjectIssueResources(
			TursoDatabaseManager.getInstance(ctx),
			project[0].id,
			{
				rangeDays: errorRangeDays(q("range")),
				filter: {
					...(status ? { status } : {}),
					...(level ? { level } : {}),
					...(platform ? { platform } : {}),
					...(release ? { release } : {}),
					...(search ? { q: search } : {}),
					...(sourceIds ? { sourceIds } : {}),
				},
				cursor,
				limit,
			},
		);

		if (page.nextCursor) {
			ctx.header("x-prism-next-cursor", encodeIssueCursor(page.nextCursor));
		}
		return ctx.json(page.items satisfies Array<ErrorIssueResource>);
	}

	public static async detail(ctx: Context<HonoConfig>) {
		const slug = ctx.req.param("slug");
		const issueId = ctx.req.param("issueId");
		if (!slug || !issueId) {
			return ctx.json(new ErrorResponse("issue_not_found").toJSON(), 404);
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
      WHERE projects.slug = ${slug}`) as Array<{
			id: string;
			organization_id: string;
		}>;

		if (project.length === 0) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}

		// Any workspace member may read diagnostic detail (frozen permission
		// mapping). A valid session from another workspace is a non-member:
		// 404, non-disclosing.
		const role = await getWorkspaceRole(
			ctx,
			user.id,
			String(project[0].organization_id),
		);
		if (!role) {
			return ctx.json(new ErrorResponse("project_not_found").toJSON(), 404);
		}

		const client = TursoDatabaseManager.getInstance(ctx);
		const [resources, aggregates, page, activity] = await Promise.all([
			projectIssueResources(client, project[0].id, {
				issueIds: [issueId],
				rangeDays: errorRangeDays(ctx.req.query("range")),
			}),
			issueAggregates(client, project[0].id, issueId),
			issueOccurrenceSummaries(client, project[0].id, issueId),
			issueActivity(client, project[0].id, issueId),
		]);

		const issue = resources[0];
		if (!issue || !aggregates) {
			return ctx.json(new ErrorResponse("issue_not_found").toJSON(), 404);
		}

		return ctx.json(
			{
				issue,
				occurrences: page.summaries,
				hasMoreOccurrences: page.hasMore,
				activity,
				occurrenceCountAll: aggregates.occurrence_count,
				usersAffectedAll: aggregates.users_affected,
				...(aggregates.first_release
					? { firstRelease: aggregates.first_release }
					: {}),
				...(aggregates.last_release
					? { lastRelease: aggregates.last_release }
					: {}),
			} satisfies ErrorIssueDetailResource,
		);
	}

	public static async update(ctx: Context<HonoConfig>) {
		const slug = ctx.req.param("slug");
		const issueId = ctx.req.param("issueId");

		if (!slug || !issueId) {
			return ctx.json(new ErrorResponse("issue_not_found").toJSON(), 404);
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
      WHERE projects.slug = ${slug}`) as Array<{
			id: string;
			organization_id: string;
		}>;

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
		// Workflow state is a restricted action: owner/admin only (frozen in
		// task-15.md; the dashboard gates the controls the same way).
		if (!isAdminRole(role)) {
			return ctx.json(new ErrorResponse("cannot_update_issue").toJSON(), 403);
		}
		// Management-action soft rate limit (per user, in-memory) so a
		// scripted caller cannot churn issue state. Rejected hits do not
		// consume quota.
		const { allowed, retryAfterSeconds } = issueWorkflowLimiter.hit(user.id);
		if (!allowed) {
			ctx.header("Retry-After", String(retryAfterSeconds));
			return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
		}

		const body = (await ctx.req
			.json()
			.catch(() => null)) as ErrorIssueStateRequest | null;
		const status = body?.status;
		if (typeof status !== "string" || !STATUS_VALUES.has(status)) {
			return ctx.json(new ErrorResponse("invalid_status").toJSON(), 400);
		}

		const client = TursoDatabaseManager.getInstance(ctx);
		const updated = await updateIssueStatus(
			client,
			project[0].id,
			issueId,
			status as ErrorIssueStatus,
			user.id,
		);
		if (!updated) {
			return ctx.json(new ErrorResponse("issue_not_found").toJSON(), 404);
		}

		const resources = await projectIssueResources(client, project[0].id, {
			issueIds: [issueId],
		});
		const resource = resources[0];
		if (!resource) {
			return ctx.json(new ErrorResponse("issue_not_found").toJSON(), 404);
		}

		return ctx.json(resource satisfies ErrorIssueResource);
	}
}
