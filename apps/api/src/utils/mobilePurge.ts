import type { Client, InStatement } from "@libsql/client";

/**
 * Immediate mobile privacy/deletion boundary (Task 18; R2-F5/R3-F7).
 *
 * Scheduled retention is NOT an acceptable delay for a deletion request.
 * Every deletion path (project / source / person) calls the matching
 * helper here IN THE SAME operation that removes events or sources:
 * screen projections first (FK-cascade + explicit), then affected
 * session/installation aggregates are recomputed or removed - no mobile
 * journey data survives the call.
 */

/** Project deletion: everything for the project goes. */
export function purgeMobileProjectStatements(projectId: string): InStatement[] {
	return [
		{ sql: "DELETE FROM mobile_screen_views WHERE project_id = ?", args: [projectId] },
		{ sql: "DELETE FROM mobile_app_sessions WHERE project_id = ?", args: [projectId] },
		{ sql: "DELETE FROM mobile_installations WHERE project_id = ?", args: [projectId] },
	];
}

/** Source deletion/archive: all telemetry captured by one source. */
export function purgeMobileSourceStatements(
	projectId: string,
	sourceId: string,
): InStatement[] {
	return [
		{ sql: "DELETE FROM mobile_screen_views WHERE project_id = ? AND source_id = ?", args: [projectId, sourceId] },
		{ sql: "DELETE FROM mobile_app_sessions WHERE project_id = ? AND source_id = ?", args: [projectId, sourceId] },
		{
			sql: `DELETE FROM mobile_installations WHERE project_id = ? AND installation_digest NOT IN (
				SELECT DISTINCT installation_digest FROM mobile_app_sessions
				WHERE project_id = ? AND installation_digest IS NOT NULL
			) AND project_id = ?`,
			args: [projectId, projectId, projectId],
		},
	];
}

/**
 * Person deletion: their events (and cascaded screens) are gone; sessions
 * and installations with NO surviving telemetry in the project are removed
 * immediately. Sessions keep lifecycle-only rows when other telemetry for
 * the same session survives.
 */
export function reconcileMobileAfterPersonStatements(
	projectId: string,
): InStatement[] {
	return [
		{
			sql: `DELETE FROM mobile_screen_views WHERE project_id = ? AND event_id NOT IN (
				SELECT id FROM events WHERE project_id = mobile_screen_views.project_id
			)`,
			args: [projectId],
		},
		{
			sql: `DELETE FROM mobile_app_sessions WHERE project_id = ? AND NOT EXISTS (
				SELECT 1 FROM events e
				WHERE e.project_id = mobile_app_sessions.project_id
				AND e.session_id = mobile_app_sessions.session_id
			)`,
			args: [projectId],
		},
		{
			sql: `DELETE FROM mobile_installations WHERE project_id = ? AND installation_digest NOT IN (
				SELECT DISTINCT installation_digest FROM mobile_app_sessions
				WHERE project_id = ? AND installation_digest IS NOT NULL
			) AND project_id = ?`,
			args: [projectId, projectId, projectId],
		},
	];
}

/** Execute a purge set atomically. */
export async function executeMobilePurge(
	client: Client,
	statements: InStatement[],
): Promise<void> {
	if (statements.length === 0) return;
	await client.batch(statements, "write");
}
