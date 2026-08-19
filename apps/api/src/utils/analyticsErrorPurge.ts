/**
 * Error-data deletion workflows (task-15 slice 4).
 *
 * Privacy default: person deletion, source removal, and project deletion
 * must include error associations — occurrences, user links, workflow
 * activity, and the issues themselves. Orphan pruning mirrors the retention
 * CLI: once an issue has no remaining occurrences (because its last linked
 * person was deleted, or its source/project is gone), its workflow history
 * and user links go with it, so no personally identifying orphan records or
 * phantom counters survive.
 *
 * All purges are parameterized and scoped to the (project [, source |
 * person]) the caller has already authorized. They run in ONE atomic write
 * batch when the client supports it, else per-statement fallback (test
 * doubles, read-only stores).
 */

/** Minimal Turso-style client the purges need (execute + optional batch). */
export interface ErrorPurgeClient {
	execute(input: {
		sql: string;
		args: Array<string | number | null>;
	}): Promise<{ rows: Array<Record<string, unknown>>; rowsAffected?: number }>;
	batch?(
		statements: Array<{ sql: string; args: Array<string | number | null> }>,
		mode: "write",
	): Promise<Array<{ rowsAffected?: number }>>;
}

function runBatch(
	client: ErrorPurgeClient,
	statements: Array<{ sql: string; args: Array<string | number | null> }>,
): Promise<unknown> {
	if (statements.length === 0) return Promise.resolve(undefined);
	if (client.batch) return client.batch(statements, "write");
	return Promise.all(statements.map((statement) => client.execute(statement)));
}

/**
 * Project-scoped ORPHAN prune: workflow activity, user links, and issues
 * with no remaining occurrences are removed — the same invariant retention
 * enforces, so a burst delete never leaves dead rows behind.
 */
export function orphanErrorPruneStatements(
	projectId: string,
): Array<{ sql: string; args: Array<string | number | null> }> {
	return [
		{
			sql: `DELETE FROM error_issue_activity
            WHERE project_id = ? AND issue_id NOT IN (
              SELECT DISTINCT issue_id FROM error_occurrences WHERE project_id = ?)`,
			args: [projectId, projectId],
		},
		{
			sql: `DELETE FROM error_issue_users
            WHERE issue_id NOT IN (SELECT id FROM error_issues WHERE project_id = ?)`,
			args: [projectId],
		},
		{
			sql: `DELETE FROM error_issues
            WHERE project_id = ? AND id NOT IN (
              SELECT DISTINCT issue_id FROM error_occurrences WHERE project_id = ?)`,
			args: [projectId, projectId],
		},
	];
}

/** Purge ALL error data for a deleted project in one atomic batch. */
export async function purgeProjectErrorData(
	client: ErrorPurgeClient,
	projectId: string,
): Promise<void> {
	const statements: Array<{
		sql: string;
		args: Array<string | number | null>;
	}> = [
		{
			sql: "DELETE FROM error_issue_activity WHERE project_id = ?",
			args: [projectId],
		},
		{
			sql: "DELETE FROM error_occurrences WHERE project_id = ?",
			args: [projectId],
		},
		{
			sql: "DELETE FROM error_issue_users WHERE issue_id IN (SELECT id FROM error_issues WHERE project_id = ?)",
			args: [projectId],
		},
		{ sql: "DELETE FROM error_issues WHERE project_id = ?", args: [projectId] },
	];
	await runBatch(client, statements);
}

/** Purge error data tied to a removed source (revocation does not purge). */
export async function purgeSourceErrorData(
	client: ErrorPurgeClient,
	projectId: string,
	sourceId: string,
): Promise<void> {
	const statements: Array<{
		sql: string;
		args: Array<string | number | null>;
	}> = [
		{
			sql: "DELETE FROM error_occurrences WHERE project_id = ? AND source_id = ?",
			args: [projectId, sourceId],
		},
		...orphanErrorPruneStatements(projectId),
	];
	await runBatch(client, statements);
}

/**
 * Statements to drop one person's error associations for their anonymous
 * ids, recount the affected issues' users_affected, and prune any issue +
 * activity + user links left without occurrences. Caller runs these inside
 * its own atomic deletion batch (before or after the person-independent
 * deletes — order does not matter, the prune is the closing invariant).
 */
export async function personErrorPurgeStatements(
	client: ErrorPurgeClient,
	projectId: string,
	anonymousIds: string[],
): Promise<Array<{ sql: string; args: Array<string | number | null> }>> {
	if (anonymousIds.length === 0) return orphanErrorPruneStatements(projectId);
	const placeholders = anonymousIds.map(() => "?").join(",");

	const affected = await client.execute({
		sql: `SELECT DISTINCT iu.issue_id AS issue_id
            FROM error_issue_users iu
            JOIN error_issues i ON i.id = iu.issue_id AND i.project_id = ?
            WHERE iu.anonymous_id IN (${placeholders})`,
		args: [projectId, ...anonymousIds],
	});
	const issueIds = affected.rows.map((row) => String(row.issue_id));

	const statements: Array<{
		sql: string;
		args: Array<string | number | null>;
	}> = [
		{
			sql: `DELETE FROM error_occurrences
            WHERE project_id = ? AND anonymous_id IN (${placeholders})`,
			args: [projectId, ...anonymousIds],
		},
		{
			sql: `DELETE FROM error_issue_users
            WHERE anonymous_id IN (${placeholders})
              AND issue_id IN (SELECT id FROM error_issues WHERE project_id = ?)`,
			args: [...anonymousIds, projectId],
		},
	];
	if (issueIds.length > 0) {
		statements.push({
			sql: `UPDATE error_issues
            SET users_affected = (
              SELECT COUNT(*) FROM error_issue_users
              WHERE error_issue_users.issue_id = error_issues.id)
            WHERE id IN (${issueIds.map(() => "?").join(",")})`,
			args: [...issueIds],
		});
	}
	statements.push(...orphanErrorPruneStatements(projectId));
	return statements;
}
