import type {
	ErrorIssueActivityItem,
	ErrorIssueDelta,
	ErrorIssueLevel,
	ErrorIssuePlatform,
	ErrorIssueResource,
	ErrorIssueStatus,
	ErrorOccurrenceSummary,
	ErrorStackFrame,
} from "@prism-analytics/types";

/**
 * Bounded error-tracking reads (task-15 slices 2 + 4). All dashboard
 * aggregates are computed in the database (parameterized, project-scoped,
 * windowed) instead of loading occurrence rows into application memory.
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
 *   an auditable actor + timestamp on the issue row itself plus a row in
 *   error_issue_activity (slice 4) for the dashboard workflow history.
 */

const DAY_MS = 86_400_000;

/** Bounded page of occurrence summaries returned by the detail endpoint. */
const OCCURRENCE_PAGE_SIZE = 15;
/** Frames surfaced per occurrence summary (bounded; full chain stays opaque). */
const SUMMARY_FRAMES = 12;

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
 * Validated list filters for the Errors page. Unknown/invalid values are
 * ignored by the caller (coerced to undefined) so a malformed query string
 * never leaks or filters incorrectly.
 */
export type IssueListFilter = {
	status?: ErrorIssueStatus;
	level?: ErrorIssueLevel;
	platform?: ErrorIssuePlatform;
	/** Exact last-release match (the release seen in the most recent window). */
	release?: string;
	/** Resolved source ids (the controller maps a source NAME to its ids). */
	sourceIds?: string[];
	/** Case-insensitive title substring search. */
	q?: string;
};

/** Opaque keyset cursor: (lastSeenAt, id) of the last row of the page. */
export type IssueListCursor = { lastSeenAt: number; id: string };

export type IssueListPage = {
	items: Array<ErrorIssueResource>;
	/** Exactly one more row exists beyond this page when present. */
	nextCursor: IssueListCursor | null;
};

const LIST_DEFAULT_LIMIT = 25;
const LIST_MAX_LIMIT = 100;

export function issueListLimit(raw: string | undefined): number {
	const n = Number(raw);
	if (!Number.isFinite(n) || n < 1) return LIST_DEFAULT_LIMIT;
	return Math.min(Math.floor(n), LIST_MAX_LIMIT);
}

export function encodeIssueCursor(cursor: IssueListCursor): string {
	return Buffer.from(
		`${cursor.lastSeenAt}:${cursor.id}`,
		"utf8",
	).toString("base64url");
}

export function decodeIssueCursor(raw: string | undefined): IssueListCursor | null {
	if (!raw) return null;
	try {
		const text = Buffer.from(String(raw), "base64url").toString("utf8");
		const sep = text.indexOf(":");
		if (sep < 0) return null;
		const lastSeenAt = Number(text.slice(0, sep));
		const id = text.slice(sep + 1);
		if (!Number.isFinite(lastSeenAt) || id.length === 0) return null;
		return { lastSeenAt, id };
	} catch {
		return null;
	}
}

/**
 * Keyset-paginated issue list with server-side filters (task-15 Errors list).
 * Returns the page plus an opaque next cursor (null when this is the last
 * page). Windowed counts + delta + distinct users are computed exactly as in
 * `projectIssueResources`. `issueFilter` MUST already be validated/coerced by
 * the controller; source ids are resolved there from `project_sources`.
 */
export async function listProjectIssueResources(
	client: ErrorAnalyticsClient,
	projectId: string,
	options: {
		rangeDays?: number;
		filter?: IssueListFilter;
		cursor?: IssueListCursor | null;
		limit?: number;
	} = {},
): Promise<IssueListPage> {
	const rangeDays = options.rangeDays ?? 30;
	const now = Date.now();
	const currentWindowStart = now - rangeDays * DAY_MS;
	const previousWindowStart = now - 2 * rangeDays * DAY_MS;
	const filter = options.filter ?? {};
	const limit = options.limit ?? LIST_DEFAULT_LIMIT;

	const where: string[] = ["project_id = ?"];
	const args: Array<string | number> = [projectId];
	if (filter.status) {
		where.push("status = ?");
		args.push(filter.status);
	}
	if (filter.level) {
		where.push("level = ?");
		args.push(filter.level);
	}
	if (filter.platform) {
		where.push("platform = ?");
		args.push(filter.platform);
	}
	if (filter.release) {
		where.push("last_release = ?");
		args.push(filter.release);
	}
	if (filter.q && filter.q.trim().length > 0) {
		const needle = `%${filter.q.trim()}%`;
		where.push("title LIKE ?");
		args.push(needle);
	}
	if (filter.sourceIds && filter.sourceIds.length > 0) {
		where.push(
			`EXISTS (SELECT 1 FROM error_occurrences o
            WHERE o.issue_id = error_issues.id
              AND o.source_id IN (${filter.sourceIds.map(() => "?").join(",")})
              AND o.received_at >= ?)`,
		);
		args.push(...filter.sourceIds, previousWindowStart);
	}
	if (options.cursor) {
		const { lastSeenAt, id } = options.cursor;
		where.push("(last_seen_at < ? OR (last_seen_at = ? AND id < ?))");
		args.push(lastSeenAt, lastSeenAt, id);
	}

	const { rows } = await client.execute({
		sql: `SELECT id, title, fingerprint, platform, level, status,
            location, first_seen_at, last_seen_at
          FROM error_issues
          WHERE ${where.join(" AND \n")}
          ORDER BY last_seen_at DESC, id DESC
          LIMIT ?`,
		args: [...args, limit + 1],
	});
	const issueRows = rows as unknown as IssueRow[];
	const hasMore = issueRows.length > limit;
	const pageRows = hasMore ? issueRows.slice(0, limit) : issueRows;
	if (pageRows.length === 0) {
		return { items: [], nextCursor: null };
	}

	const [counts, users] = await Promise.all([
		windowCounts(client, projectId, currentWindowStart, previousWindowStart),
		windowUsers(client, projectId, currentWindowStart),
	]);

	const items = pageRows.map((row) =>
		toResource(
			row,
			counts.get(String(row.id)) ?? { current: 0, previous: 0 },
			users.get(String(row.id)) ?? 0,
			currentWindowStart,
		),
	);
	const lastRow = pageRows[pageRows.length - 1];
	const nextCursor = hasMore && lastRow
		? { lastSeenAt: Number(lastRow.last_seen_at), id: lastRow.id }
		: null;
	return { items, nextCursor };
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
 * with an auditable actor + timestamp, then records the user-initiated
 * transition in error_issue_activity. Reopening clears the resolved /
 * ignored metadata. Returns false when the (project, issue id) pair does
 * not exist — the caller maps that to a non-disclosing 404. An idempotent
 * no-op (same status) returns true without writing an activity row.
 */
export async function updateIssueStatus(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueId: string,
	status: ErrorIssueStatus,
	actorId: string,
): Promise<boolean> {
	// Read the prior state first so the activity log records the transition
	// and an unchanged status is treated as an idempotent success.
	const prior = await client.execute({
		sql: "SELECT status FROM error_issues WHERE id = ? AND project_id = ?",
		args: [issueId, projectId],
	});
	const priorRow = prior.rows[0] as { status?: string } | undefined;
	if (!priorRow) return false;
	const priorStatus = priorRow.status as ErrorIssueStatus;
	if (priorStatus === status) return true;

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
	if (Number(result.rowsAffected ?? 0) === 0) return false;

	const action =
		status === "resolved"
			? "resolved"
			: status === "ignored"
				? "ignored"
				: "reopened"; // new === unresolved, prior !== unresolved
	await client.execute({
		sql: `INSERT INTO error_issue_activity
          (id, issue_id, project_id, actor_id, actor_type, action,
           prior_state, new_state, timestamp)
          VALUES (?, ?, ?, ?, 'member', ?, ?, ?, ?)`,
		args: [
			`act_${randomHex()}`,
			issueId,
			projectId,
			actorId,
			action,
			priorStatus,
			status,
			now,
		],
	});
	return true;
}

/** Cryptographically-random hex id (Node ≥19 has globalThis.crypto). */
function randomHex(): string {
	const bytes = new Uint8Array(16);
	if (
		globalThis.crypto &&
		typeof globalThis.crypto.getRandomValues === "function"
	) {
		globalThis.crypto.getRandomValues(bytes);
	} else {
		for (let i = 0; i < bytes.length; i += 1) {
			bytes[i] = Math.floor(Math.random() * 256);
		}
	}
	return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
		"",
	);
}

type OccurrenceRow = {
	id: string;
	occurred_at: number;
	received_at: number;
	level: string;
	handled: number;
	release: string | null;
	environment: string | null;
	anonymous_id: string | null;
	payload: string;
};

function exceptionFromPayload(
	payload: unknown,
): ErrorOccurrenceSummary["exception"] {
	const exception = (payload as { exception?: unknown } | null)?.exception;
	if (!exception || typeof exception !== "object") {
		return { type: "(unknown)", frames: [], hasCause: false };
	}
	const record = exception as Record<string, unknown>;
	const frames = (Array.isArray(record.frames) ? record.frames : [])
		.slice(0, SUMMARY_FRAMES)
		.map((frame) => {
			const f = frame as Record<string, unknown>;
			return {
				file: typeof f.file === "string" ? f.file : null,
				...(typeof f.function === "string" && f.function !== ""
					? { function: f.function }
					: {}),
				line: typeof f.line === "number" ? f.line : null,
				column: typeof f.column === "number" ? f.column : null,
				inApp: f.inApp === true,
			} as ErrorStackFrame;
		});
	const cause = record.cause ?? null;
	return {
		type: typeof record.type === "string" ? record.type : "(unknown)",
		...(typeof record.message === "string" && record.message !== ""
			? { message: record.message }
			: {}),
		frames,
		hasCause: cause !== null && typeof cause === "object",
	};
}

/**
 * A bounded page of sanitized occurrence summaries for one issue, newest
 * first, plus whether more occurrences exist past the page. The summary is
 * derived from the ALREADY-sanitized persisted payload — reading it back is
 * safe, and the read path never re-fetches raw client input.
 */
export async function issueOccurrenceSummaries(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueId: string,
): Promise<{ summaries: ErrorOccurrenceSummary[]; hasMore: boolean }> {
	const { rows } = await client.execute({
		sql: `SELECT id, occurred_at, received_at, level, handled, release,
              environment, anonymous_id, payload
            FROM error_occurrences
            WHERE project_id = ? AND issue_id = ?
            ORDER BY received_at DESC
            LIMIT ?`,
		args: [projectId, issueId, OCCURRENCE_PAGE_SIZE + 1],
	});
	const page = rows as unknown as OccurrenceRow[];
	const hasMore = page.length > OCCURRENCE_PAGE_SIZE;
	const summaries = page
		.slice(0, OCCURRENCE_PAGE_SIZE)
		.map((row): ErrorOccurrenceSummary => {
			let payload: unknown = {};
			try {
				payload = JSON.parse(row.payload) as unknown;
			} catch {
				payload = {};
			}
			const record = payload as {
				language?: unknown;
				context?: {
					tags?: Record<string, unknown>;
					extras?: Record<string, unknown>;
				};
				breadcrumbs?: Array<unknown>;
			};
			const rawTags = record.context?.tags as
				| Record<string, unknown>
				| undefined;
			const rawExtras = record.context?.extras as
				| Record<string, unknown>
				| undefined;
			const tagsCount = rawTags ? Object.keys(rawTags).length : 0;
			const extrasCount = rawExtras ? Object.keys(rawExtras).length : 0;
			const breadcrumbsCount = Array.isArray(record.breadcrumbs)
				? record.breadcrumbs.length
				: 0;
			const language =
				typeof record.language === "string" && record.language.trim() !== ""
					? record.language.trim().slice(0, 32).toLowerCase()
					: undefined;
			// Expose sanitized maps for UI (bounded to 12 keys each, already redacted)
			const tags = rawTags
				? Object.fromEntries(
						Object.entries(rawTags)
							.slice(0, 12)
							.map(([k, v]) => [
								k,
								typeof v === "string" ? v : String(v ?? ""),
							]),
					)
				: undefined;
			const extras = rawExtras
				? Object.fromEntries(Object.entries(rawExtras).slice(0, 12))
				: undefined;
			return {
				id: row.id,
				occurredAt: Number(row.occurred_at),
				receivedAt: Number(row.received_at),
				level: row.level as ErrorIssueLevel,
				handled: row.handled === 1,
				...(row.release ? { release: row.release } : {}),
				...(row.environment ? { environment: row.environment } : {}),
				...(row.anonymous_id ? { anonymousId: row.anonymous_id } : {}),
				...(language ? { language } : {}),
				exception: exceptionFromPayload(payload),
				tagsCount,
				extrasCount,
				breadcrumbsCount,
				...(tags && Object.keys(tags).length > 0 ? { tags } : {}),
				...(extras && Object.keys(extras).length > 0 ? { extras } : {}),
			};
		});
	return { summaries, hasMore };
}

/** Bounded workflow history for one issue, newest first. */
export async function issueActivity(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueId: string,
	limit = 50,
): Promise<ErrorIssueActivityItem[]> {
	const { rows } = await client.execute({
		sql: `SELECT id, actor_id, actor_type, action, prior_state, new_state,
              timestamp, note
            FROM error_issue_activity
            WHERE project_id = ? AND issue_id = ?
            ORDER BY timestamp DESC
            LIMIT ?`,
		args: [projectId, issueId, limit],
	});
	return (rows as Array<Record<string, unknown>>).map((row) => ({
		id: String(row.id),
		action: String(row.action) as ErrorIssueActivityItem["action"],
		priorState: String(row.prior_state) as ErrorIssueStatus,
		newState: String(row.new_state) as ErrorIssueStatus,
		actorType:
			row.actor_type === "system" ? ("system" as const) : ("member" as const),
		...(row.actor_id ? { actorId: String(row.actor_id) } : {}),
		timestamp: Number(row.timestamp),
		...(row.note ? { note: String(row.note) } : {}),
	}));
}

export type IssueAggregateRow = {
	occurrence_count: number;
	users_affected: number;
	first_release: string | null;
	last_release: string | null;
};

/** Safe all-time aggregates for one issue (counts, users, release bounds). */
export async function issueAggregates(
	client: ErrorAnalyticsClient,
	projectId: string,
	issueId: string,
): Promise<IssueAggregateRow | null> {
	const { rows } = await client.execute({
		sql: `SELECT occurrence_count, users_affected, first_release, last_release
            FROM error_issues
            WHERE project_id = ? AND id = ?`,
		args: [projectId, issueId],
	});
	const row = rows[0] as IssueAggregateRow | undefined;
	return row ?? null;
}
