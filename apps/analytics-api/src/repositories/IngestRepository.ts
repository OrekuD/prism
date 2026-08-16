import { INGEST_LIMITS } from "@prism/core";
import type { Client } from "@libsql/client";
import type { InStatement } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import { logger } from "../utils/logger.js";
import {
  identityClaimStatement,
  identityMutationStatements,
  personIdForUser,
  resolveEventPerson,
} from "../utils/identityResolution.js";
import type {
  ValidatedEvent,
  ValidatedIdentityOp,
} from "../utils/ingestValidation.js";

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
     session_id, anonymous_id, user_id, person_id, properties, context,
     sdk_name, sdk_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    private readonly client: Pick<Client, "batch" | "transaction"> =
      TursoDatabaseManager.instance,
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
    identityOps: ValidatedIdentityOp[] = [],
    alreadyProcessedOpIds: ReadonlySet<string> = new Set(),
    externalLinks: ReadonlyMap<string, string> = new Map(),
    anonymousLinks: ReadonlyMap<string, string> = new Map(),
    replacementPersonIds: ReadonlyMap<string, string> = new Map(),
  ): Promise<PersistedEventResult[]> {
    // R4-F2/R4-F3: ONE write transaction with sequential visibility —
    // identity claims gate their mutations (rowsAffected = 1 wins), and
    // person/session projections run only for events whose inserts won
    // the idempotency conflict. A failure rolls back EVERYTHING.
    const tx = await this.client.transaction("write");
    try {
      // F7: event persons resolve against the DURABLE links (pre-read by
      // the controller) — an explicit user link wins, then an active
      // anonymous link, then a fresh anonymous person.
      const resolvedPersons = events.map((event) =>
        resolveEventPerson(
          projectId,
          event.userId,
          event.anonymousId,
          externalLinks,
          anonymousLinks,
        ),
      );

      // 1. Identity claims + claim-gated mutations (R4-F2).
      for (const op of identityOps) {
        if (alreadyProcessedOpIds.has(op.opId)) continue;
        const deterministic = personIdForUser(projectId, op.userId);
        const knownPersonId =
          replacementPersonIds.get(deterministic) ?? deterministic;
        const claim = await tx.execute(
          identityClaimStatement(projectId, op, receivedAt, knownPersonId) as InStatement,
        );
        if (claim.rowsAffected !== 1) continue; // losing claim: NO side effects
        for (const statement of identityMutationStatements(
          projectId,
          op,
          receivedAt,
          knownPersonId,
        )) {
          await tx.execute(statement as InStatement);
        }
      }

      // 2. Event inserts — outcomes captured per statement.
      const insertResults: Array<{ rowsAffected: number }> = [];
      for (const event of events) {
        const personId = resolvedPersons[events.indexOf(event)] ?? null;
        const result = await tx.execute({
          sql: INSERT_EVENT_SQL,
          args: [
            event.eventId,
            projectId,
            event.type,
            event.name,
            event.schemaVersion,
            event.occurredAt,
            receivedAt,
            event.sessionId ?? null,
            event.anonymousId ?? null,
            event.userId ?? null,
            personId,
            JSON.stringify(event.properties),
            JSON.stringify(event.context ?? {}),
            sdk?.name ?? null,
            sdk?.version ?? null,
          ],
        });
        insertResults.push({ rowsAffected: result.rowsAffected });
      }

      // 3. Projections for the WINNING events only (R4-F3): a duplicate
      // replay never advances last_seen_at or the session state.
      for (let index = 0; index < events.length; index += 1) {
        if ((insertResults[index]?.rowsAffected ?? 0) === 0) continue;
        const event = events[index] ?? { occurredAt: receivedAt } as ValidatedEvent;
        const personId = resolvedPersons[index];
        if (personId) {
          await tx.execute({
            sql: `INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT (project_id, person_id)
                  DO UPDATE SET last_seen_at = excluded.last_seen_at`,
            args: [personId, projectId, event.occurredAt, receivedAt],
          });
        }
        const session = sessionStatement(event, projectId, receivedAt);
        if (session) await tx.execute(session);
      }

      await tx.commit();

      return events.map((event, index) => ({
        eventId: event.eventId,
        duplicate: (insertResults[index]?.rowsAffected ?? 0) === 0,
      }));
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

}
