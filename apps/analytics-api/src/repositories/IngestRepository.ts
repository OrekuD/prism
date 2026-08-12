import { INGEST_LIMITS } from "@prism/core";
import type { Client } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import type { ValidatedEvent } from "../utils/ingestValidation.js";

/**
 * Batch persistence boundary (task-9 slice-4 review F6).
 *
 * One database outcome per request: ALL validated events commit in one
 * atomic Turso "write" batch, or NONE of them do. The controller never
 * owns transaction details. The (project_id, id) primary key plus the
 * conflict-safe insert keeps replays idempotent — a committed replay
 * reports `duplicate`, never a second row.
 */
export interface PersistedEventResult {
  eventId: string;
  duplicate: boolean;
}

const INSERT_EVENT_SQL = `
  INSERT INTO events_v2
    (id, project_id, type, name, schema_version, occurred_at, received_at,
     session_id, anonymous_id, properties, context)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (project_id, id) DO NOTHING
`;

export class IngestRepository {
  constructor(
    private readonly client: Pick<Client, "batch"> = TursoDatabaseManager.instance,
  ) {}

  /**
   * Persist every validated event in ONE write-transaction batch. Rejects
   * (throws) when the transaction fails — nothing is committed. SDK
   * metadata is derived from the authoritative batch-level `sdk` and
   * stored with each event (review F13); user context cannot override it.
   */
  async persistBatch(
    projectId: string,
    events: ValidatedEvent[],
    receivedAt: number,
    sdk?: { name: string; version: string },
  ): Promise<PersistedEventResult[]> {
    const statements = events.map((event) => {
      const storedContext: Record<string, unknown> = { ...(event.context ?? {}) };
      if (sdk) storedContext.sdk = sdk;
      return {
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
          JSON.stringify(storedContext),
        ],
      };
    });

    const results = await this.client.batch(statements, "write");

    return events.map((event, index) => ({
      eventId: event.eventId,
      duplicate: (results[index]?.rowsAffected ?? 0) === 0,
    }));
  }
}
