import { INGEST_LIMITS } from "@prism/core";
import type { Client, InStatement } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import type { ValidatedEvent } from "../utils/ingestValidation.js";

/**
 * Batch persistence boundary (task-9 slice-4 review F6, slice 5).
 *
 * One database outcome per request: ALL validated events commit in one
 * atomic Turso "write" batch, or NONE of them do. The controller never
 * owns transaction details. The (project_id, id) primary key plus the
 * conflict-safe insert keeps replays idempotent — a committed replay
 * reports `duplicate`, never a second row.
 *
 * SDK identity is derived from the authoritative batch-level `sdk` and
 * stored in EXPLICIT columns (slice-4 review F13) — the user context can
 * never override it, and it is not duplicated into the context JSON.
 */
export interface PersistedEventResult {
  eventId: string;
  duplicate: boolean;
}

const INSERT_EVENT_SQL = `
  INSERT INTO events
    (id, project_id, type, name, schema_version, occurred_at, received_at,
     session_id, anonymous_id, properties, context, sdk_name, sdk_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (project_id, id) DO NOTHING
`;

export class IngestRepository {
  constructor(
    private readonly client: Pick<Client, "batch"> = TursoDatabaseManager.instance,
  ) {}

  /**
   * Persist every validated event in ONE write-transaction batch. Rejects
   * (throws) when the transaction fails — nothing is committed. The same
   * batch also maintains the sessions_v2 state table (task-9 slice 6):
   * session_started upserts the session row, session_ended closes it, and
   * any sessioned event bumps last_seen_at — so realtime session state
   * and event storage commit atomically.
   */
  async persistBatch(
    projectId: string,
    events: ValidatedEvent[],
    receivedAt: number,
    sdk?: { name: string; version: string },
  ): Promise<PersistedEventResult[]> {
    const statements: InStatement[] = [];
    const insertPositions: number[] = [];
    for (const event of events) {
      insertPositions.push(statements.length);
      const base = {
        sql: INSERT_EVENT_SQL,
        args: [
          event.eventId,
          projectId,
          event.type,
          event.name,
          INGEST_LIMITS.schemaVersion,
          event.occurredAt,
          receivedAt,
          event.sessionId ?? null,
          event.anonymousId ?? null,
          JSON.stringify(event.properties),
          JSON.stringify(event.context ?? {}),
          sdk?.name ?? null,
          sdk?.version ?? null,
        ],
      };
      statements.push(base);
      if (!event.sessionId) {
        continue;
      }
      if (event.name === "session_started") {
        statements.push({
          sql: `INSERT INTO sessions_v2 (session_id, project_id, anonymous_id, started_at, last_seen_at, context, is_online)
                VALUES (?, ?, ?, ?, ?, ?, 1)
                ON CONFLICT (project_id, session_id)
                DO UPDATE SET last_seen_at = excluded.last_seen_at, is_online = 1`,
          args: [
            event.sessionId,
            projectId,
            event.anonymousId ?? null,
            event.occurredAt,
            receivedAt,
            JSON.stringify(event.context ?? {}),
          ],
        });
      } else if (event.name === "session_ended") {
        statements.push({
          sql: "UPDATE sessions_v2 SET ended_at = ?, last_seen_at = ?, is_online = 0 WHERE session_id = ? AND project_id = ?",
          args: [event.occurredAt, receivedAt, event.sessionId, projectId],
        });
      } else {
        statements.push({
          sql: "UPDATE sessions_v2 SET last_seen_at = ? WHERE session_id = ? AND project_id = ?",
          args: [receivedAt, event.sessionId, projectId],
        });
      }
    }

    const results = await this.client.batch(statements, "write");

    return events.map((event, index) => ({
      eventId: event.eventId,
      duplicate: (results[insertPositions[index] ?? 0]?.rowsAffected ?? 0) === 0,
    }));
  }
}
