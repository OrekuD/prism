import type {
	ErrorIssueDelta,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueResource,
	ErrorIssueStatus,
} from "@prism-analytics/types";

/**
 * Bounded error-tracking reads (task-15 slice 2). All dashboard aggregates
 * are computed in the database (parameterized, project-scoped, windowed)
 * instead of loading occurrence rows into application memory.
 *
 * Honest semantics:
 * - `count` / `users` are WINDOWED against the Errors page range selector:
 *   occurrences whose `received_at` falls in the current window, and the
 *   distinct anonymous ids seen in that window.
 * - `delta` compares the current window against the preceding equal-length
 *   window: an issue whose first occurrence landed inside the window is
 *   "new"; a positive (versus zero) previous-window baseline that is growing
 *   is "regressing", shrinking is "declining"; without a prior-window
 *   baseline the delta is null rather than fabricated.
 * - `firstSeen`/`lastSeen` are the issue's all-time bounds (the durable group
 *   timestamps), never inflected by the selected range.
 * - State writes are owner/admin-only (enforced in the controller) and keep
 *   an auditable actor + timestamp on the issue row itself.
 */

const DAY_MS = 86_400_000;

/** Days per Errors-page range key (unknown values fall back to 30). */
const RANGE_DAYS: Record<string, number> = {
	"24h": 1,
	"seven-days": 7,
	"two-weeks": 14,
	"one-month": 30,
};

export function errorRangeDays(range: string | undefined): number {
	if (range && range in RANGE_DAYS) return RANGE_DAYS[range] ?? 30;
	return 30;
}

/** The product API only READS error data; writes come from analytics-ingest. */
export interface ErrorAnalyticsClient {
	execute(input: {
		sql: string;
		args: Array<string | number | null>;
	}): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>;
}

export type IssueRow = {
	id: string;
	title: string;
	fingerprint: string;
	platform: string;
	level: string;
	status: string;
	location: string | null;
	first_seen_at: number;
	last_seen_at: number;
};

type WindowCounts = { current: number; previous: number };

/** Direction of the issue relative to the previous window. */
export function issueDelta(
	firstSeenAt: number,
	current: number,
	previous: number,
	currentWindowStart: number,
): ErrorIssueDelta {
	if (firstSeenAt >= currentWindowStart) return "new";
	if (previous > 0 && current > previous) return "regressing";
	if (previous > 0 && current < previous) return "declining";
	return null;
}

function toResource(
	row: IssueRow,
	counts: WindowCounts,
	users: number,
	currentWindowStart: number,
): ErrorIssueResource {
	return {
		id: row.id,
		title: row.title,
		fingerprint: row.fingerprint,
		platform: row.platform as ErrorIssuePlatform,
		level: row.level as ErrorIssueLevel,
		status: row.status as ErrorIssueStatus,
		count: counts.current,
		users,
		delta: issueDelta(
			Number(row.first_seen_at),
			counts.current,
			counts.previous,
			currentWindowStart,
		),
		firstSeen: Number(row.first_seen_at),
		lastSeen: Number(row.last_seen_at),
		location: row.location === null ? undefined : row.location,
	};
}

async function projectIssues(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueIds: string[] | undefined,
): Promise<IssueRow[]> {
	const whereClause = issueIds
		? `WHERE project_id = ? AND id IN (${issueIds.map(() => "?").join(",")})`
		: "WHERE project_id = ?";
	const whereArgs: Array<string> = issueIds
		? [projectId, ...issueIds]
		: [projectId];
	const { rows } = await client.execute({
		sql: `SELECT id, title, fingerprint, platform, level, status,
            location, first_seen_at, last_seen_at
          FROM error_issues
          ${whereClause}
          ORDER BY last_seen_at DESC
          LIMIT 200`,
		args: [...whereArgs],
	});
	return rows as unknown as IssueRow[];
}

/**
 * Windowed occurrence counts per issue: occurrences in the current window
 * and in the preceding equal-length window (the delta baseline).
 */
async function windowCounts(
	client: ErrorAnalyticsClient,
	projectId: string,
	currentWindowStart: number,
	previousWindowStart: number,
): Promise<Map<string, WindowCounts>> {
	const { rows } = await client.execute({
		sql: `SELECT issue_id,
            SUM(CASE WHEN received_at >= ? THEN 1 ELSE 0 END) AS current_count,
            SUM(CASE WHEN received_at < ? AND received_at >= ? THEN 1 ELSE 0 END) AS previous_count
          FROM error_occurrences
          WHERE project_id = ? AND received_at >= ?
          GROUP BY issue_id`,
		args: [
			currentWindowStart,
			currentWindowStart,
			previousWindowStart,
			projectId,
			previousWindowStart,
		],
	});
	const byIssue = new Map<string, WindowCounts>();
	for (const row of rows) {
		byIssue.set(String(row.issue_id), {
			current: Number(row.current_count ?? 0),
			previous: Number(row.previous_count ?? 0),
		});
	}
	return byIssue;
}

/** Distinct anonymous users seen in the current window, per issue. */
async function windowUsers(
	client: ErrorAnalyticsClient,
	projectId: string,
	currentWindowStart: number,
): Promise<Map<string, number>> {
	const { rows } = await client.execute({
		sql: `SELECT issue_id, COUNT(DISTINCT anonymous_id) AS users
          FROM error_occurrences
          WHERE project_id = ?
            AND received_at >= ?
            AND anonymous_id IS NOT NULL
            AND anonymous_id != ''
          GROUP BY issue_id`,
		args: [projectId, currentWindowStart],
	});
	const byIssue = new Map<string, number>();
	for (const row of rows) {
		byIssue.set(String(row.issue_id), Number(row.users ?? 0));
	}
	return byIssue;
}

/**
 * The project's issue resources: newest-first, bounded (200 rows), each
 * enriched with windowed counts + delta + distinct users. When
 * `issueIds` narrows the query to those issues (used after a state write
 * so the response reflects the just-updated row).
 */
export async function projectIssueResources(
	client: ErrorAnalyticsClient,
	projectId: string,
	options: { issueIds?: string[]; rangeDays?: number } = {},
): Promise<ErrorIssueResource[]> {
	const rangeDays = options.rangeDays ?? 30;
	const now = Date.now();
	const currentWindowStart = now - rangeDays * DAY_MS;
	const previousWindowStart = now - 2 * rangeDays * DAY_MS;

	const rows = await projectIssues(client, projectId, options.issueIds);
	if (rows.length === 0) return [];

	const [counts, users] = await Promise.all([
		windowCounts(client, projectId, currentWindowStart, previousWindowStart),
		windowUsers(client, projectId, currentWindowStart),
	]);

	return rows.map((row) =>
		toResource(
			row,
			counts.get(String(row.id)) ?? { current: 0, previous: 0 },
			users.get(String(row.id)) ?? 0,
			currentWindowStart,
		),
	);
}

/**
 * Applies a workflow status transition for an issue in ONE atomic UPDATE
 * with an auditable actor + timestamp. Reopening clears the resolved /
 * ignored metadata. Returns false when the (project, issue id) pair does
 * not exist — the caller maps that to a non-disclosing 404.
 */
export async function updateIssueStatus(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueId: string,
	status: ErrorIssueStatus,
	actorId: string,
): Promise<boolean> {
	const now = Date.now();
	const result = await client.execute({
		sql: `UPDATE error_issues
          SET status = ?,
              resolved_by = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
              resolved_at = CASE WHEN ? = 'resolved' THEN ? ELSE NULL END,
              ignored_by = CASE WHEN ? = 'ignored' THEN ? ELSE NULL END,
              ignored_at = CASE WHEN ? = 'ignored' THEN ? ELSE NULL END
          WHERE id = ? AND project_id = ?`,
		args: [
			status,
			status,
			actorId,
			status,
			now,
			status,
			actorId,
			status,
			now,
			issueId,
			projectId,
		],
	});
	return Number(result.rowsAffected ?? 0) > 0;
}
