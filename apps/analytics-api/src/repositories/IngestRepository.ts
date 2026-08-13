import { INGEST_LIMITS } from "@prism/core";
import type { Client, InStatement } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import { logger } from "../utils/logger.js";
import type { ValidatedEvent } from "../utils/ingestValidation.js";

/**
 * Batch persistence boundary (task-9 slice-4 review F6, slice 5, release
 * review round 3).
 *
 * One database outcome per request: ALL validated events commit in one
 * atomic Turso "write" batch, or NONE of them do. The controller never
 * owns transaction details. The (project_id, id) primary key plus the
 * conflict-safe insert keeps replays idempotent — a committed replay
 * reports `duplicate`, never a second row.
 *
 * Session-state mutations (sessions_v2) run ONLY for events that were
 * NEWLY inserted (release review: a replayed session_started must never
 * reopen an ended session — duplicates change NOTHING). They run in a
 * second write batch; sessions_v2 is derived state, so its failure is a
 * recoverable diagnostic while the events (the source of truth) are
 * already committed.
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

/** Session-state statement for a NEWLY inserted event (duplicates skip). */
function sessionStatement(
  event: ValidatedEvent,
  projectId: string,
  receivedAt: number,
): InStatement | null {
  if (!event.sessionId) return null;
  if (event.name === "session_started") {
    return {
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
    };
  }
  if (event.name === "session_ended") {
    return {
      sql: "UPDATE sessions_v2 SET ended_at = ?, last_seen_at = ?, is_online = 0 WHERE session_id = ? AND project_id = ?",
      args: [event.occurredAt, receivedAt, event.sessionId, projectId],
    };
  }
  return {
    sql: "UPDATE sessions_v2 SET last_seen_at = ? WHERE session_id = ? AND project_id = ?",
    args: [receivedAt, event.sessionId, projectId],
  };
}

export class IngestRepository {
  constructor(
    private readonly client: Pick<Client, "batch"> = TursoDatabaseManager.instance,
  ) {}

  /**
   * Persist every validated event in ONE write-transaction batch, then
   * apply session-state mutations for the NEWLY INSERTED events only.
   * Rejects (throws) when the event transaction fails — nothing is
   * committed.
   */
  async persistBatch(
    projectId: string,
    events: ValidatedEvent[],
    receivedAt: number,
    sdk?: { name: string; version: string },
  ): Promise<PersistedEventResult[]> {
    const insertStatements: InStatement[] = events.map((event) => ({
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
    }));

    const insertResults = await this.client.batch(insertStatements, "write");

    const outcomes = events.map((event, index) => {
      const duplicate = (insertResults[index]?.rowsAffected ?? 0) === 0;
      return { event, duplicate };
    });

    // Derived session state ONLY for newly inserted events — a duplicate
    // replay changes nothing about the session.
    const sessionStatements = outcomes
      .filter((outcome) => !outcome.duplicate)
      .map((outcome) => sessionStatement(outcome.event, projectId, receivedAt))
      .filter((statement): statement is InStatement => statement !== null);

    if (sessionStatements.length > 0) {
      try {
        await this.client.batch(sessionStatements, "write");
      } catch (error) {
        // The events are committed — the response stays honest
        // ("accepted" is true for the events). The derived session state
        // is recoverable: the next sessioned event refreshes it, and a
        // diagnostic records the gap. Never fail the request here.
        logger.error("analytics:ingest", "session state update failed", {
          message: error instanceof Error ? error.message : "unknown",
          projectId,
        });
      }
    }

    return outcomes.map((outcome) => ({
      eventId: outcome.event.eventId,
      duplicate: outcome.duplicate,
    }));
  }
}
