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
export function buildIdentityStatements(
  projectId: string,
  op: { opId: string; userId: string; anonymousId: string; traits?: Record<string, unknown>; unset?: readonly string[] },
  receivedAt: number,
): IdentityOpStatement[] {
  const knownPersonId = personIdForUser(projectId, op.userId);
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

  statements.push({
    sql: `INSERT INTO identity_ops (project_id, op_id, person_id, user_id, processed_at)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT (project_id, op_id) DO NOTHING`,
    args: [projectId, op.opId, knownPersonId, op.userId, receivedAt],
  });

  return statements;
}

/** Person id for the response/diagnostics — never the raw user id. */
export function personLabel(projectId: string, userId: string): string {
  return personIdForUser(projectId, userId);
}
