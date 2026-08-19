import type {
	ErrorIssueDetailResource,
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
	projectIssueResources,
	updateIssueStatus,
} from "../utils/errorIssuesStore";
import { getWorkspaceRole, isAdminRole } from "../utils/workspaceAuth";

const STATUS_VALUES: ReadonlySet<string> = new Set<ErrorIssueStatus>([
	"unresolved",
	"resolved",
	"ignored",
]);

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
