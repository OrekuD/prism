/**
 * Error ingestion persistence (task-15 slice 1).
 *
 * ONE write transaction with sequential visibility, mirroring the v2
 * ingest repository: the occurrence insert gates everything after it —
 * a retried client event id (unique per project + source) wins 0 rows
 * and skips the issue updates, so duplicate delivery never bumps counts
 * or last-seen. Issue grouping uses the deterministic fingerprint id,
 * so create/find never needs a read-then-write round trip.
 */

import type { Client } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";

export interface ErrorPersistItem {
	/** Position in the submitted batch (results keep submitted order). */
	index: number;
	/** Server-generated occurrence id. */
	occurrenceId: string;
	/** Client error event id (idempotency key, scoped per project+source). */
	clientEventId: string;
	/** Deterministic issue id (project + platform + fingerprint). */
	issueId: string;
	projectId: string;
	sourceId: string;
	platform: string;
	level: "error" | "warning";
	handled: boolean;
	occurredAt: number;
	receivedAt: number;
	release?: string;
	environment?: string;
	anonymousId?: string;
	fingerprintVersion: number;
	fingerprint: string;
	title: string;
	location?: string;
	/** Sanitized normalized payload JSON. */
	payload: string;
}

export type ErrorPersistOutcome = Array<{ index: number; duplicate: boolean }>;

export class ErrorIngestRepository {
	private readonly client: Pick<Client, "transaction" | "execute">;

	constructor(
		client: Pick<Client, "transaction" | "execute"> = TursoDatabaseManager.instance,
	) {
		this.client = client;
	}

	/** Live issues for a project (storage/abuse cap check). */
	public async countIssues(projectId: string): Promise<number> {
		const { rows } = await this.client.execute({
			sql: "SELECT COUNT(*) AS n FROM error_issues WHERE project_id = ?",
			args: [projectId],
		});
		return Number(rows[0]?.n ?? 0);
	}

	/** Occurrences for a project+source (storage/abuse cap check). */
	public async countOccurrences(
		projectId: string,
		sourceId: string,
	): Promise<number> {
		const { rows } = await this.client.execute({
			sql: "SELECT COUNT(*) AS n FROM error_occurrences WHERE project_id = ? AND source_id = ?",
			args: [projectId, sourceId],
		});
		return Number(rows[0]?.n ?? 0);
	}

	/** The ids among `issueIds` that ALREADY exist for the project. */
	public async existingIssueIds(
		projectId: string,
		issueIds: string[],
	): Promise<Set<string>> {
		if (issueIds.length === 0) return new Set();
		const { rows } = await this.client.execute({
			sql: `SELECT id FROM error_issues WHERE project_id = ? AND id IN (${issueIds
				.map(() => "?")
				.join(",")})`,
			args: [projectId, ...issueIds],
		});
		return new Set(rows.map((row) => String(row.id)));
	}

	public async persistBatch(
		items: ErrorPersistItem[],
	): Promise<ErrorPersistOutcome> {
		if (items.length === 0) return [];

		const tx = await this.client.transaction("write");
		const outcome: ErrorPersistOutcome = [];
		try {
			for (const item of items) {
				const inserted = await tx.execute({
					sql: `INSERT INTO error_occurrences (
            id, client_event_id, issue_id, project_id, source_id, platform,
            level, handled, occurred_at, received_at, release, environment,
            anonymous_id, payload
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (project_id, source_id, client_event_id) DO NOTHING`,
					args: [
						item.occurrenceId,
						item.clientEventId,
						item.issueId,
						item.projectId,
						item.sourceId,
						item.platform,
						item.level,
						item.handled ? 1 : 0,
						item.occurredAt,
						item.receivedAt,
						item.release ?? null,
						item.environment ?? null,
						item.anonymousId ?? null,
						item.payload,
					],
				});

				const duplicate = Number(inserted.rowsAffected ?? 0) === 0;
				if (!duplicate) {
					// Upsert the issue. A new occurrence after resolution REOPENS
					// the issue (unresolved); first/last release track the extremes;
					// first_seen/level/title are fixed by the first occurrence.
					await tx.execute({
						sql: `INSERT INTO error_issues (
              id, project_id, platform, fingerprint_version, fingerprint,
              level, status, title, location, first_seen_at, last_seen_at,
              occurrence_count, users_affected, first_release, last_release
            ) VALUES (?, ?, ?, ?, ?, ?, 'unresolved', ?, ?, ?, ?, 1, 0, ?, ?)
            ON CONFLICT (project_id, platform, fingerprint_version, fingerprint)
            DO UPDATE SET
              occurrence_count = error_issues.occurrence_count + 1,
              last_seen_at = MAX(error_issues.last_seen_at, excluded.last_seen_at),
              last_release = COALESCE(excluded.last_release, error_issues.last_release),
              status = CASE WHEN error_issues.status = 'resolved'
                THEN 'unresolved' ELSE error_issues.status END`,
						args: [
							item.issueId,
							item.projectId,
							item.platform,
							item.fingerprintVersion,
							item.fingerprint,
							item.level,
							item.title,
							item.location ?? null,
							item.occurredAt,
							item.occurredAt,
							item.release ?? null,
							item.release ?? null,
						],
					});

					if (item.anonymousId) {
						await tx.execute({
							sql: `INSERT OR IGNORE INTO error_issue_users (issue_id, anonymous_id)
                VALUES (?, ?)`,
							args: [item.issueId, item.anonymousId],
						});
						await tx.execute({
							sql: `UPDATE error_issues
                SET users_affected = (
                  SELECT COUNT(*) FROM error_issue_users WHERE issue_id = ?
                ) WHERE id = ?`,
							args: [item.issueId, item.issueId],
						});
					}
				}
				outcome.push({ index: item.index, duplicate });
			}
			await tx.commit();
			return outcome;
		} catch (error) {
			await tx.rollback().catch(() => undefined);
			throw error;
		}
	}
}
