import { createHash } from "node:crypto";

/**
 * Identity resolution (task-10 §4, ADR 0003): DETERMINISTIC person IDs.
 *
 * person_id = 'u_<sha256(projectId:userId)>' for known people and
 * 'a_<sha256(projectId:anonymousId)>' for anonymous-only identities. A
 * deterministic ID means concurrent identifies for the same external user
 * always target the SAME person row (ON CONFLICT DO NOTHING converges),
 * and replaying an op after a crash cannot create duplicate people.
 *
 * Identity links are durable first-wins records: an anonymous ID is never
 * silently re-linked to a second person over a shared device. When an op
 * links an anonymous identity to a known person, the anonymous-only
 * person's events are REASSIGNED to the known person (the derived
 * projection rebuild — raw events are untouched).
 */

export function personIdForUser(projectId: string, userId: string): string {
  return `u_${createHash("sha256").update(`${projectId}:${userId}`).digest("hex").slice(0, 32)}`;
}

export function personIdForAnonymous(projectId: string, anonymousId: string): string {
  return `a_${createHash("sha256").update(`${projectId}:${anonymousId}`).digest("hex").slice(0, 32)}`;
}

/** The person an EVENT belongs to (user wins over the anonymous link). */
export function eventPersonId(
  projectId: string,
  userId: string | undefined,
  anonymousId: string | undefined,
): string | null {
  if (userId) return personIdForUser(projectId, userId);
  if (anonymousId) return personIdForAnonymous(projectId, anonymousId);
  return null;
}

/**
 * F7: resolve an event's person against the DURABLE identity links. The
 * controller pre-reads the link maps inside the persistence flow:
 * an explicit user link wins, then an active anonymous link, then a fresh
 * anonymous person. Events carrying a userId whose person does not exist
 * yet resolve deterministically (u_ hash — the identify op creates it).
 */
export function resolveEventPerson(
  projectId: string,
  userId: string | undefined,
  anonymousId: string | undefined,
  externalLinks: ReadonlyMap<string, string>,
  anonymousLinks: ReadonlyMap<string, string>,
): string | null {
  if (userId) {
    return externalLinks.get(userId) ?? personIdForUser(projectId, userId);
  }
  if (anonymousId) {
    return anonymousLinks.get(anonymousId) ?? personIdForAnonymous(projectId, anonymousId);
  }
  return null;
}

/** Canonical payload hash for identity-op idempotency (F8 + R3-F4). */
export function identityOpHash(op: {
  opId: string;
  userId: string;
  anonymousId: string;
  traits?: Record<string, unknown>;
  unset?: readonly string[];
  occurredAt: number;
}): string {
  return createHash("sha256")
    .update(JSON.stringify({ ...op, opId: undefined }))
    .digest("hex")
    .slice(0, 32);
}

export interface IdentityOpStatement {
  sql: string;
  args: unknown[];
}

/**
 * Build the identity-processing statements for one op (all idempotent,
 * order-independent within the batch):
 * 1. ensure the known person row;
 * 2. record the external-identity link (first wins);
 * 3. link the anonymous identity (first wins) and reassign the
 *    anonymous-only person's events + drop its empty person row;
 * 4. apply trait unset + upserts;
 * 5. record the processed op (dedupe by op_id).
 */
/**
 * R4-F2: the transactional claim — INSERTed FIRST; the caller gates every
 * following mutation on its rowsAffected (1 = claimed, 0 = already
 * processed). Runs inside a write transaction so the claim is visible to
 * the subsequent guarded statements.
 */
export function identityClaimStatement(
  projectId: string,
  op: { opId: string; userId: string; anonymousId: string; traits?: Record<string, unknown>; unset?: readonly string[]; occurredAt: number },
  receivedAt: number,
  knownPersonId: string,
): IdentityOpStatement {
  return {
    sql: `INSERT INTO identity_ops (project_id, op_id, person_id, user_id, processed_at, payload_hash)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT (project_id, op_id) DO NOTHING`,
    args: [
      projectId,
      op.opId,
      knownPersonId,
      op.userId,
      receivedAt,
      identityOpHash(op),
    ],
  };
}

/** Every mutation authorized by a successful claim (R4-F2). */
export function identityMutationStatements(
  projectId: string,
  op: { opId: string; userId: string; anonymousId: string; traits?: Record<string, unknown>; unset?: readonly string[]; occurredAt: number },
  receivedAt: number,
  knownPersonId: string,
): IdentityOpStatement[] {
  const anonPersonId = personIdForAnonymous(projectId, op.anonymousId);
  const statements: IdentityOpStatement[] = [
    {
      sql: `INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, person_id) DO NOTHING`,
      args: [knownPersonId, projectId, receivedAt, receivedAt],
    },
    {
      sql: `INSERT INTO external_identities (project_id, user_id, person_id, linked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, user_id) DO NOTHING`,
      args: [projectId, op.userId, knownPersonId, receivedAt],
    },
    {
      sql: `INSERT INTO anonymous_identities (project_id, anonymous_id, person_id, linked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, anonymous_id) DO NOTHING`,
      args: [projectId, op.anonymousId, knownPersonId, receivedAt],
    },
    {
      // R7-F1: events accepted under a DELETED generation's anonymous
      // credential are never reassigned into a later identity — the
      // tombstone guard runs in the same transaction (sequential
      // visibility).
      sql: `UPDATE events SET person_id = ?
            WHERE project_id = ? AND person_id = ? AND user_id IS NULL
              AND NOT EXISTS (
                SELECT 1 FROM deleted_identities
                WHERE project_id = ? AND kind = 'anonymous' AND credential = ?
              )`,
      args: [knownPersonId, projectId, anonPersonId, projectId, op.anonymousId],
    },
    {
      sql: 'DELETE FROM people WHERE project_id = ? AND person_id = ?',
      args: [projectId, anonPersonId],
    },
  ];
  for (const key of op.unset ?? []) {
    statements.push({
      sql: "DELETE FROM person_traits WHERE project_id = ? AND person_id = ? AND key = ?",
      args: [projectId, knownPersonId, key],
    });
  }
  for (const [key, value] of Object.entries(op.traits ?? {})) {
    statements.push({
      sql: `INSERT INTO person_traits (project_id, person_id, key, value, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (project_id, person_id, key)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [projectId, knownPersonId, key, JSON.stringify(value), receivedAt],
    });
  }
  return statements;
}

export function buildIdentityStatements(
  projectId: string,
  op: { opId: string; userId: string; anonymousId: string; traits?: Record<string, unknown>; unset?: readonly string[]; occurredAt: number },
  receivedAt: number,
  replacementPersonIds?: ReadonlyMap<string, string>,
): IdentityOpStatement[] {
  // F5: a DELETED person's deterministic id is replaced with a fresh id on
  // re-identify — late events from the deleted identity (which resolve to
  // the old deterministic id) can never attach to the new person.
  const deterministic = personIdForUser(projectId, op.userId);
  const knownPersonId = replacementPersonIds?.get(deterministic) ?? deterministic;
  const anonPersonId = personIdForAnonymous(projectId, op.anonymousId);

  // F8: the claim record is written with the canonical payload hash FIRST
  // (same transaction as the mutations). Every mutation is idempotent:
  // links are first-wins, traits upsert to the same values for the same
  // payload, and the person row converges. Conflicting-payload replays
  // are detected by the controller's hash comparison and REJECTED before
  // any statement is built.
  const statements: IdentityOpStatement[] = [
    {
      sql: `INSERT INTO identity_ops (project_id, op_id, person_id, user_id, processed_at, payload_hash)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (project_id, op_id) DO NOTHING`,
      // R3-F4: the stored hash uses the ORIGINAL wire occurredAt — the
      // same representation the controller compares on replay.
      args: [projectId, op.opId, knownPersonId, op.userId, receivedAt, identityOpHash(op)],
    },
    // The person row is shared per external user — idempotent upsert.
    {
      sql: `INSERT INTO people (person_id, project_id, first_seen_at, last_seen_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, person_id) DO NOTHING`,
      args: [knownPersonId, projectId, receivedAt, receivedAt],
    },
    {
      sql: `INSERT INTO external_identities (project_id, user_id, person_id, linked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, user_id) DO NOTHING`,
      args: [projectId, op.userId, knownPersonId, receivedAt],
    },
    {
      sql: `INSERT INTO anonymous_identities (project_id, anonymous_id, person_id, linked_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT (project_id, anonymous_id) DO NOTHING`,
      args: [projectId, op.anonymousId, knownPersonId, receivedAt],
    },
    {
      // Reassign the anonymous-only person's history to the known person
      // (derived projection rebuild — raw events untouched).
      sql: 'UPDATE events SET person_id = ? WHERE project_id = ? AND person_id = ? AND user_id IS NULL',
      args: [knownPersonId, projectId, anonPersonId],
    },
    {
      // The anonymous-only person row is now empty of links and history.
      sql: 'DELETE FROM people WHERE project_id = ? AND person_id = ?',
      args: [projectId, anonPersonId],
    },
  ];

  for (const key of op.unset ?? []) {
    statements.push({
      sql: "DELETE FROM person_traits WHERE project_id = ? AND person_id = ? AND key = ?",
      args: [projectId, knownPersonId, key],
    });
  }
  for (const [key, value] of Object.entries(op.traits ?? {})) {
    statements.push({
      sql: `INSERT INTO person_traits (project_id, person_id, key, value, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (project_id, person_id, key)
            DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
      args: [projectId, knownPersonId, key, JSON.stringify(value), receivedAt],
    });
  }

  return statements;
}


export function personLabel(projectId: string, userId: string): string {
  return personIdForUser(projectId, userId);
}
