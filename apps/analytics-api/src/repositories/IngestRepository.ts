import { INGEST_LIMITS } from "@prism/core";
import type { Client } from "@libsql/client";
import type { InStatement } from "@libsql/client";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import { logger } from "../utils/logger.js";
import {
  identityClaimStatement,
  identityMutationStatements,
  identityOpHash,
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

/** Identity-op outcome returned by the transaction (R5-F1): the claim
 * result is authoritative — a losing claim reads the stored hash in the
 * SAME transaction and returns duplicate or rejected, never accepted. */
export interface PersistedIdentityOutcome {
  index: number;
  opId: string;
  status: "accepted" | "duplicate" | "rejected";
  reason?: string;
}

export interface PersistBatchOutcome {
  results: PersistedEventResult[];
  identity: PersistedIdentityOutcome[];
}

const INSERT_EVENT_SQL = `
  INSERT INTO events
    (id, project_id, source_id, platform, type, name, schema_version,
     occurred_at, received_at, session_id, anonymous_id, user_id, person_id,
     properties, context, sdk_name, sdk_version)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (project_id, id) DO NOTHING
`;

/** Session-state statement for a NEWLY inserted event (duplicates skip). */
function sessionStatement(
  event: ValidatedEvent,
  projectId: string,
  receivedAt: number,
  source?: { sourceId: string; platform: string },
): InStatement | null {
  if (!event.sessionId) return null;
  if (event.name === "session_started") {
    return {
      sql: `INSERT INTO sessions_v2 (session_id, project_id, source_id, platform, anonymous_id, started_at, last_seen_at, context, is_online)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)
            ON CONFLICT (project_id, session_id)
            DO UPDATE SET last_seen_at = excluded.last_seen_at, is_online = 1`,
      args: [
        event.sessionId,
        projectId,
        source?.sourceId ?? null,
        source?.platform ?? null,
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
    identityOps: Array<{ index: number; op: ValidatedIdentityOp; status?: string; reason?: string }> = [],
    externalLinks: ReadonlyMap<string, string> = new Map(),
    anonymousLinks: ReadonlyMap<string, string> = new Map(),
    replacementPersonIds: ReadonlyMap<string, string> = new Map(),
    source?: { sourceId: string; platform: string },
  ): Promise<PersistBatchOutcome> {
    // R4-F2/R4-F3/R5-F1: ONE write transaction with sequential visibility —
    // identity claims gate their mutations (rowsAffected = 1 wins), losing
    // claims read the stored hash IN THE TRANSACTION and return
    // duplicate/rejected (never accepted), and person/session projections
    // run only for events whose inserts won the idempotency conflict.
    const tx = await this.client.transaction("write");
    try {
      const identityOutcomes: PersistedIdentityOutcome[] = [];
      // Effective link maps: durable links + ONLY successfully claimed
      // ops' links (R5-F1: a losing op never steers events; R5-F2:
      // first-wins — an existing durable anonymous mapping is never
      // replaced in-memory).
      const effectiveExternal = new Map(externalLinks);
      const effectiveAnonymous = new Map(anonymousLinks);

      // 1. Identity claims (authoritative outcomes).
      for (const entry of identityOps) {
        const { op } = entry;
        if (entry.status === "rejected") {
          identityOutcomes.push({
            index: entry.index,
            opId: op.opId,
            status: "rejected",
            reason: entry.reason,
          });
          continue;
        }
        const deterministic = personIdForUser(projectId, op.userId);
        const knownPersonId =
          replacementPersonIds.get(deterministic) ?? deterministic;
        const claim = await tx.execute(
          identityClaimStatement(projectId, op, receivedAt, knownPersonId) as InStatement,
        );
        if (claim.rowsAffected === 1) {
          // R6-F2: after the claim wins, the EXTERNAL-IDENTITY link is the
          // authoritative resolution — claim it (first-wins) and read the
          // winner so concurrent re-identifications can never fragment one
          // user across replacement people.
          await tx.execute({
            sql: `INSERT INTO external_identities (project_id, user_id, person_id, linked_at)
                  VALUES (?, ?, ?, ?)
                  ON CONFLICT (project_id, user_id) DO NOTHING`,
            args: [projectId, op.userId, knownPersonId, receivedAt],
          });
          const authoritative = await tx.execute({
            sql: "SELECT person_id FROM external_identities WHERE project_id = ? AND user_id = ?",
            args: [projectId, op.userId],
          });
          const resolvedPerson = String(
            (authoritative.rows[0] as { person_id?: unknown } | undefined)?.person_id ?? "",
          );
          const authoritativePerson = resolvedPerson || knownPersonId;
          // Keep the identity-op record consistent with the durable link.
          await tx.execute({
            sql: "UPDATE identity_ops SET person_id = ? WHERE project_id = ? AND op_id = ?",
            args: [authoritativePerson, projectId, op.opId],
          });

          identityOutcomes.push({
            index: entry.index,
            opId: op.opId,
            status: "accepted",
          });
          for (const statement of identityMutationStatements(
            projectId,
            op,
            receivedAt,
            authoritativePerson,
          )) {
            await tx.execute(statement as InStatement);
          }
          // Fold ONLY the claimed op's links — never replacing a durable
          // mapping (R5-F2 first-wins).
          if (!effectiveExternal.has(op.userId)) {
            effectiveExternal.set(op.userId, authoritativePerson);
          }
          if (!effectiveAnonymous.has(op.anonymousId)) {
            effectiveAnonymous.set(op.anonymousId, authoritativePerson);
          }
        } else {
          // Losing claim: compare the stored hash FIRST (R6-F1) — the
          // stored person folds ONLY for an exact duplicate. A conflicting
          // payload returns rejected and leaves both maps unchanged so the
          // in-transaction durable-link re-read resolves the event IDs
          // themselves — fresh incoming IDs can never be routed to the
          // original operation's person.
          const stored = await tx.execute({
            sql: "SELECT person_id, payload_hash FROM identity_ops WHERE project_id = ? AND op_id = ?",
            args: [projectId, op.opId],
          });
          const storedRow = stored.rows[0] as
            | { person_id?: unknown; payload_hash?: unknown }
            | undefined;
          const storedHash = String(storedRow?.payload_hash ?? "");
          if (storedHash === identityOpHash(op)) {
            const storedPerson = String(storedRow?.person_id ?? "");
            if (storedPerson) {
              if (!effectiveExternal.has(op.userId)) {
                effectiveExternal.set(op.userId, storedPerson);
              }
              if (!effectiveAnonymous.has(op.anonymousId)) {
                effectiveAnonymous.set(op.anonymousId, storedPerson);
              }
            }
            identityOutcomes.push({
              index: entry.index,
              opId: op.opId,
              status: "duplicate",
            });
          } else {
            identityOutcomes.push({
              index: entry.index,
              opId: op.opId,
              status: "rejected",
              reason: "conflicting-payload",
            });
          }
        }
      }

      // R5-F1: a stale pre-read may have missed durable links — re-read
      // them inside the transaction for every batch id not yet resolved.
      const missingAnon = [
        ...new Set(
          events
            .map((event) => event.anonymousId)
            .filter((id): id is string => !!id),
        ),
      ].filter((id) => !effectiveAnonymous.has(id));
      const missingUsers = [
        ...new Set(
          events
            .map((event) => event.userId)
            .filter((id): id is string => !!id),
        ),
      ].filter((id) => !effectiveExternal.has(id));
      if (missingAnon.length > 0 || missingUsers.length > 0) {
        const [anonRows, userRows] = await Promise.all([
          missingAnon.length > 0
            ? tx.execute({
                sql: `SELECT anonymous_id, person_id FROM anonymous_identities WHERE project_id = ? AND anonymous_id IN (${missingAnon.map(() => "?").join(",")})`,
                args: [projectId, ...missingAnon],
              })
            : Promise.resolve({ rows: [] }),
          missingUsers.length > 0
            ? tx.execute({
                sql: `SELECT user_id, person_id FROM external_identities WHERE project_id = ? AND user_id IN (${missingUsers.map(() => "?").join(",")})`,
                args: [projectId, ...missingUsers],
              })
            : Promise.resolve({ rows: [] }),
        ]);
        for (const row of anonRows.rows) {
          const anonId = String((row as { anonymous_id?: unknown }).anonymous_id ?? "");
          if (anonId && !effectiveAnonymous.has(anonId)) {
            effectiveAnonymous.set(anonId, String((row as { person_id?: unknown }).person_id ?? ""));
          }
        }
        for (const row of userRows.rows) {
          const userId = String((row as { user_id?: unknown }).user_id ?? "");
          if (userId && !effectiveExternal.has(userId)) {
            effectiveExternal.set(userId, String((row as { person_id?: unknown }).person_id ?? ""));
          }
        }
      }

      // F7: event persons resolve against the EFFECTIVE links (durable +
      // claimed ops only).
      const resolvedPersons = events.map((event) =>
        resolveEventPerson(
          projectId,
          event.userId,
          event.anonymousId,
          effectiveExternal,
          effectiveAnonymous,
        ),
      );

      // 2. Event inserts — outcomes captured per statement.
      const insertResults: Array<{ rowsAffected: number }> = [];
      for (let index = 0; index < events.length; index += 1) {
        const event = events[index] ?? ({} as ValidatedEvent);
        const personId = resolvedPersons[index] ?? null;
        const result = await tx.execute({
          sql: INSERT_EVENT_SQL,
          args: [
            event.eventId,
            projectId,
            source?.sourceId ?? null,
            source?.platform ?? null,
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
        const event = events[index] ?? ({} as ValidatedEvent);
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
        const session = sessionStatement(event, projectId, receivedAt, source);
        if (session) await tx.execute(session);
      }

      await tx.commit();

      return {
        results: events.map((event, index) => ({
          eventId: event.eventId,
          duplicate: (insertResults[index]?.rowsAffected ?? 0) === 0,
        })),
        identity: identityOutcomes,
      };
    } catch (error) {
      await tx.rollback().catch(() => undefined);
      throw error;
    }
  }

}
