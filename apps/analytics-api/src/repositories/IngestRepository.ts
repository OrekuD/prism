import { INGEST_LIMITS } from "@prism/core";
import type { Client } from "@libsql/client";
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
   * (throws) when the transaction fails — nothing is committed.
   */
  async persistBatch(
    projectId: string,
    events: ValidatedEvent[],
    receivedAt: number,
    sdk?: { name: string; version: string },
  ): Promise<PersistedEventResult[]> {
    const statements = events.map((event) => ({
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

    const results = await this.client.batch(statements, "write");

    return events.map((event, index) => ({
      eventId: event.eventId,
      duplicate: (results[index]?.rowsAffected ?? 0) === 0,
    }));
  }
}
