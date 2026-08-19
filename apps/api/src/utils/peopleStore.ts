import type {
  BreakdownResource,
  EventResource,
  PeopleListResource,
  PeopleResource,
  PersonDetailResource,
  TotalsResource,
} from "@prism-analytics/types";

import { personErrorPurgeStatements } from "./analyticsErrorPurge";

/**
 * People + baseline query store (task-10 §5): bounded, parameterized,
 * project-scoped reads over the identity tables. Every read is scoped by
 * project_id BEFORE filtering or pagination; keyset cursors keep pages
 * bounded; stored JSON is decoded at the boundary (malformed values are
 * quarantined to null — never crash a response); counts are honest
 * DISTINCT metrics (events ≠ people ≠ anonymous identities ≠ sessions).
 */

interface AnalyticsClient {
  execute(input: {
    sql: string;
    args: Array<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
  batch?(
    statements: Array<{ sql: string; args: Array<string | number | null> }>,
    mode: "write",
  ): Promise<Array<{ rowsAffected: number }>>;
}

const PAGE_SIZE = 50;

function decodeJson(raw: unknown): unknown {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    return JSON.parse(String(raw)) as unknown;
  } catch {
    return null;
  }
}

/** Event properties: a JSON OBJECT or null (malformed values are quarantined). */
function decodeProperties(raw: unknown): Record<string, unknown> | null {
  const parsed = decodeJson(raw);
  if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
    return parsed as Record<string, unknown>;
  }
  return null;
}

export interface PeopleListParams {
  cursor?: string;
  limit?: number;
  /** Exact external-ID match (no prefix/fuzzy — documented limitation). */
  searchUserId?: string;
  /** Exact indexed safe-trait match: traitKey=value. */
  searchTrait?: { key: string; value: string };
}

/**
 * Bounded people list, keyset-paginated on (last_seen_at DESC,
 * person_id) — a stable order for cursor pagination. Counts are
 * correlated subqueries over the (project_id, person_id, received_at)
 * index — bounded per page, never a full-project load.
 */
export async function peopleList(
  client: AnalyticsClient,
  projectId: string,
  params: PeopleListParams = {},
): Promise<PeopleListResource> {
  const limit = Math.min(Math.max(params.limit ?? PAGE_SIZE, 1), 100);
  const clauses: string[] = ["p.project_id = ?"];
  const args: Array<string | number | null> = [projectId];
  let searchExact = false;

  if (params.searchUserId) {
    // Exact external-ID match only — broad PII enumeration is out of
    // scope and documented.
    clauses.push(`p.person_id = (SELECT person_id FROM external_identities
      WHERE project_id = ? AND user_id = ? LIMIT 1)`);
    args.push(projectId, params.searchUserId);
    searchExact = true;
  }
  if (params.searchTrait) {
    clauses.push(`p.person_id IN (SELECT person_id FROM person_traits
      WHERE project_id = ? AND key = ? AND value = ?)`);
    args.push(projectId, params.searchTrait.key, JSON.stringify(params.searchTrait.value));
    searchExact = true;
  }
  if (params.cursor) {
    const [lastSeen, personId] = params.cursor.split(":");
    if (lastSeen && personId) {
      clauses.push("(p.last_seen_at < ? OR (p.last_seen_at = ? AND p.person_id < ?))");
      args.push(Number(lastSeen), Number(lastSeen), personId);
    }
  }

  const where = clauses.join(" AND ");
  const { rows } = await client.execute({
    sql: `SELECT
            p.person_id,
            p.first_seen_at,
            p.last_seen_at,
            (SELECT COUNT(*) FROM events e
              WHERE e.project_id = p.project_id AND e.person_id = p.person_id) AS event_count,
            (SELECT COUNT(DISTINCT session_id) FROM events e
              WHERE e.project_id = p.project_id AND e.person_id = p.person_id
                AND e.session_id IS NOT NULL) AS session_count,
            (SELECT COUNT(*) FROM external_identities x
              WHERE x.project_id = p.project_id AND x.person_id = p.person_id)
              + (SELECT COUNT(*) FROM anonymous_identities a
                WHERE a.project_id = p.project_id AND a.person_id = p.person_id) AS identity_count
          FROM people p
          WHERE ${where}
          ORDER BY p.last_seen_at DESC, p.person_id DESC
          LIMIT ?`,
    args: [...args, limit + 1],
  });

  const page = rows.slice(0, limit);
  const hasMore = rows.length > limit;
  const last = page[page.length - 1];
  const nextCursor =
    hasMore && last
      ? `${String(last.last_seen_at)}:${String(last.person_id)}`
      : null;

  const people = await Promise.all(
    page.map(async (row) => ({
      personId: String(row.person_id),
      firstSeenAt: Number(row.first_seen_at),
      lastSeenAt: Number(row.last_seen_at),
      traits: await personTraits(client, projectId, String(row.person_id)),
      identityCount: Number(row.identity_count ?? 0),
      sessionCount: Number(row.session_count ?? 0),
      eventCount: Number(row.event_count ?? 0),
    })),
  );

  // A search that returned nothing is an honest empty result.
  void searchExact;
  return { people, nextCursor };
}

async function personTraits(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
): Promise<Record<string, unknown>> {
  const { rows } = await client.execute({
    sql: "SELECT key, value FROM person_traits WHERE project_id = ? AND person_id = ?",
    args: [projectId, personId],
  });
  const traits: Record<string, unknown> = {};
  for (const row of rows) {
    traits[String(row.key)] = decodeJson(row.value);
  }
  return traits;
}

/** Person detail: traits + every linked external + anonymous identity. */
export async function personDetail(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
): Promise<PersonDetailResource | null> {
  const { rows } = await client.execute({
    sql: "SELECT person_id, first_seen_at, last_seen_at FROM people WHERE project_id = ? AND person_id = ?",
    args: [projectId, personId],
  });
  const person = rows[0];
  if (!person) return null;

  // F14: real project-scoped counts — never hardcoded zeros.
  const [external, anonymous, counts] = await Promise.all([
    client.execute({
      sql: "SELECT user_id FROM external_identities WHERE project_id = ? AND person_id = ?",
      args: [projectId, personId],
    }),
    client.execute({
      sql: "SELECT anonymous_id FROM anonymous_identities WHERE project_id = ? AND person_id = ?",
      args: [projectId, personId],
    }),
    client.execute({
      sql: `SELECT
              COUNT(*) AS events,
              COUNT(DISTINCT session_id) AS sessions
            FROM events
            WHERE project_id = ? AND person_id = ?`,
      args: [projectId, personId],
    }),
  ]);

  return {
    personId: String(person.person_id),
    firstSeenAt: Number(person.first_seen_at),
    lastSeenAt: Number(person.last_seen_at),
    traits: await personTraits(client, projectId, personId),
    identityCount: external.rows.length + anonymous.rows.length,
    sessionCount: Number((counts.rows[0] as { sessions?: unknown } | undefined)?.sessions ?? 0),
    eventCount: Number((counts.rows[0] as { events?: unknown } | undefined)?.events ?? 0),
    externalIds: external.rows.map((row) => String(row.user_id)),
    anonymousIds: anonymous.rows.map((row) => String(row.anonymous_id)),
  };
}

/** Person activity: a bounded, chronological event timeline. */
export async function personActivity(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
  limit = 200,
  offset = 0,
): Promise<EventResource[]> {
  const { rows } = await client.execute({
    sql: `SELECT id, session_id, project_id, name, properties, occurred_at, received_at, schema_version
          FROM events
          WHERE project_id = ? AND person_id = ?
          ORDER BY received_at DESC, id DESC
          LIMIT ? OFFSET ?`,
    args: [projectId, personId, limit, offset],
  });
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: row.session_id === null || row.session_id === undefined
      ? null
      : String(row.session_id),
    projectId: String(row.project_id),
    name: String(row.name),
    properties: decodeProperties(row.properties),
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
    schemaVersion: Number(row.schema_version),
  }));
}

export interface EventFilterParams {
  from?: number;
  to?: number;
  name?: string;
  personId?: string;
  sessionId?: string;
  propertyKey?: string;
  propertyValue?: string;
  limit?: number;
}

/** Events explorer: bounded listing with date/name/person/session/safe-property filters. */
export async function filteredEvents(
  client: AnalyticsClient,
  projectId: string,
  params: EventFilterParams = {},
): Promise<EventResource[]> {
  const limit = Math.min(Math.max(params.limit ?? 200, 1), 500);
  const clauses: string[] = ["project_id = ?"];
  const args: Array<string | number | null> = [projectId];
  if (params.from !== undefined) {
    clauses.push("received_at >= ?");
    args.push(params.from);
  }
  if (params.to !== undefined) {
    clauses.push("received_at <= ?");
    args.push(params.to);
  }
  if (params.name) {
    clauses.push("name = ?");
    args.push(params.name);
  }
  if (params.personId) {
    clauses.push("person_id = ?");
    args.push(params.personId);
  }
  if (params.sessionId) {
    clauses.push("session_id = ?");
    args.push(params.sessionId);
  }
  if (params.propertyKey) {
    // Exact safe-property filter via JSON extraction (parameterized).
    clauses.push("json_extract(properties, ?) = ?");
    args.push(`$.${params.propertyKey}`, params.propertyValue ?? "");
  }

  const { rows } = await client.execute({
    sql: `SELECT id, session_id, project_id, name, properties, occurred_at, received_at, schema_version
          FROM events
          WHERE ${clauses.join(" AND ")}
          ORDER BY received_at DESC, id DESC
          LIMIT ?`,
    args: [...args, limit],
  });
  return rows.map((row) => ({
    id: String(row.id),
    sessionId: row.session_id === null || row.session_id === undefined
      ? null
      : String(row.session_id),
    projectId: String(row.project_id),
    name: String(row.name),
    properties: decodeProperties(row.properties),
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
    schemaVersion: Number(row.schema_version),
  }));
}

export type BreakdownDimension =
  | "event"
  | "person"
  | "session"
  | "context-kind"
  | "context-platform";

const DIMENSION_EXPRESSIONS: Record<BreakdownDimension, string> = {
  event: "name",
  person: "person_id",
  session: "session_id",
  "context-kind": "json_extract(context, '$.kind')",
  "context-platform": "json_extract(context, '$.platform')",
};

/**
 * Bounded breakdowns: GROUP BY the dimension with parameterized SQL,
 * capped cardinality (LIMIT 100). Honest counts — DISTINCT sessions
 * where the dimension is a session.
 */
export async function breakdown(
  client: AnalyticsClient,
  projectId: string,
  dimension: BreakdownDimension,
  from?: number,
  to?: number,
): Promise<BreakdownResource> {
  const expr = DIMENSION_EXPRESSIONS[dimension] ?? "name";
  const clauses = ["project_id = ?"];
  const args: Array<string | number | null> = [projectId];
  if (from !== undefined) {
    clauses.push("received_at >= ?");
    args.push(from);
  }
  if (to !== undefined) {
    clauses.push("received_at <= ?");
    args.push(to);
  }
  const { rows } = await client.execute({
    sql: `SELECT ${expr} AS key, COUNT(*) AS count
          FROM events
          WHERE ${clauses.join(" AND ")} AND ${expr} IS NOT NULL
          GROUP BY ${expr}
          ORDER BY count DESC
          LIMIT 100`,
    args,
  });
  return {
    dimension,
    rows: rows.map((row) => ({
      key: String(row.key ?? "unknown"),
      count: Number(row.count ?? 0),
    })),
  };
}

/**
 * Honest totals: event occurrences, unique resolved people, unique
 * anonymous identities, and sessions — four DISTINCT metrics, never
 * conflated.
 */
export async function honestTotals(
  client: AnalyticsClient,
  projectId: string,
  from?: number,
  to?: number,
): Promise<TotalsResource> {
  const clauses = ["project_id = ?"];
  const args: Array<string | number | null> = [projectId];
  if (from !== undefined) {
    clauses.push("received_at >= ?");
    args.push(from);
  }
  if (to !== undefined) {
    clauses.push("received_at <= ?");
    args.push(to);
  }
  const where = clauses.join(" AND ");
  const { rows } = await client.execute({
    sql: `SELECT
            COUNT(*) AS events,
            COUNT(DISTINCT person_id) AS people,
            COUNT(DISTINCT anonymous_id) AS anonymous_identities,
            COUNT(DISTINCT session_id) AS sessions
          FROM events
          WHERE ${where}`,
    args,
  });
  // F15: "people" = KNOWN people — those with an active external
  // identity. Anonymous-only subjects are reported through
  // anonymous_identities; the two metrics never double-count.
  const knownPeople = await client.execute({
    sql: `SELECT COUNT(DISTINCT e.person_id) AS n
          FROM events e
          WHERE ${where} AND e.person_id IN (
            SELECT person_id FROM external_identities WHERE project_id = ?
          )`,
    args: [...args, projectId],
  });
  const row = rows[0] ?? {};
  return {
    events: Number(row.events ?? 0),
    people: Number(knownPeople.rows[0]?.n ?? 0),
    anonymousIdentities: Number(row.anonymous_identities ?? 0),
    sessions: Number(row.sessions ?? 0),
  };
}

/** Project-scoped person existence (for detail/export/delete authorization). */
export async function personExists(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
): Promise<boolean> {
  const { rows } = await client.execute({
    sql: "SELECT 1 FROM people WHERE project_id = ? AND person_id = ? LIMIT 1",
    args: [projectId, personId],
  });
  return rows.length > 0;
}


// ---------------------------------------------------------------------------
// §6 — privacy export + deletion
// ---------------------------------------------------------------------------

/** Person export: identity references, traits, sessions, events — documented analytics data only. */
/** A bounded error-occurrence row for a person's export (sanitized payload). */
export type ErrorOccurrenceExport = {
  occurredAt: number;
  level: string;
  handled: boolean;
  release?: string;
  environment?: string;
  issueTitle: string;
  exceptionType?: string;
  message?: string;
};

export interface PersonExport {
  projectId: string;
  personId: string;
  exportedAt: number;
  externalIds: string[];
  anonymousIds: string[];
  traits: Record<string, unknown>;
  sessions: Array<{ sessionId: string; startedAt: number; lastSeenAt: number }>;
  events: EventResource[];
  errorOccurrences: ErrorOccurrenceExport[];
}

/**
 * Exhaustive, bounded error-occurrence export for a person's anonymous ids:
 * one row per sanitized occurrence (type/message from the persisted payload,
 * handled/release/environment, owning issue title). Pages internally until
 * every row is included — a privacy export must not silently truncate.
 */
export async function personErrorOccurrences(
  client: AnalyticsClient,
  projectId: string,
  anonymousIds: string[],
): Promise<ErrorOccurrenceExport[]> {
  if (anonymousIds.length === 0) return [];
  const placeholders = anonymousIds.map(() => "?").join(",");
  const rows: Array<Record<string, unknown>> = [];
  const PAGE = 500;
  for (let offset = 0; ; offset += PAGE) {
    const { rows: page } = await client.execute({
      sql: `SELECT o.occurred_at AS occurred_at, o.level AS level,
              o.handled AS handled, o.release AS release,
              o.environment AS environment, i.title AS issue_title,
              o.payload AS payload
            FROM error_occurrences o
            JOIN error_issues i ON i.id = o.issue_id
            WHERE o.project_id = ? AND o.anonymous_id IN (${placeholders})
            ORDER BY o.received_at DESC
            LIMIT ? OFFSET ?`,
      args: [projectId, ...anonymousIds, PAGE, offset],
    });
    rows.push(...page);
    if (page.length < PAGE) break;
  }
  return rows.map((row) => {
    let exception: Record<string, unknown> | null = null;
    try {
      exception = (
        JSON.parse(String(row.payload)) as { exception?: Record<string, unknown> }
      ).exception ?? null;
    } catch {
      exception = null;
    }
    return {
      occurredAt: Number(row.occurred_at ?? 0),
      level: String(row.level ?? ""),
      handled: row.handled === 1,
      ...(row.release ? { release: String(row.release) } : {}),
      ...(row.environment ? { environment: String(row.environment) } : {}),
      issueTitle: String(row.issue_title ?? ""),
      ...(exception?.type ? { exceptionType: String(exception.type) } : {}),
      ...(typeof exception?.message === "string"
        ? { message: exception.message }
        : {}),
    };
  });
}

/**
 * Build a person's export (bounded — a documented analytics-data export:
 * identity references, traits, sessions, events, and error occurrences;
 * never keys, tokens, raw IPs, or other users' data).
 */
export async function exportPerson(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
): Promise<PersonExport | null> {
  const person = await personDetail(client, projectId, personId);
  if (!person) return null;

  const sessions = (
    await client.execute({
      sql: `SELECT session_id, MIN(occurred_at) AS started_at, MAX(received_at) AS last_seen_at
            FROM events
            WHERE project_id = ? AND person_id = ? AND session_id IS NOT NULL
            GROUP BY session_id`,
      args: [projectId, personId],
    })
  ).rows.map((row) => ({
    sessionId: String(row.session_id),
    startedAt: Number(row.started_at ?? 0),
    lastSeenAt: Number(row.last_seen_at ?? 0),
  }));

  // F14: EXHAUSTIVE export — internal pagination until every event is
  // included (a privacy export must not silently truncate).
  const events: EventResource[] = [];
  let offset = 0;
  const PAGE = 500;
  for (;;) {
    const page = await personActivity(client, projectId, personId, PAGE, offset);
    events.push(...page);
    if (page.length < PAGE) break;
    offset += PAGE;
  }

  const errorOccurrences = await personErrorOccurrences(
    client,
    projectId,
    person.anonymousIds,
  );

  return {
    projectId,
    personId,
    exportedAt: Date.now(),
    externalIds: person.externalIds,
    anonymousIds: person.anonymousIds,
    traits: person.traits,
    sessions,
    events,
    errorOccurrences,
  };
}

/**
 * Destructive person deletion (task-10 §6): removes identity links FIRST
 * (a future use of the same external userId creates a NEW person —
 * deleted history never silently returns), then traits, then events, then
 * the person row — one atomic batch, idempotent (deleting an already
 * deleted person is a no-op that still returns the deletion record).
 */
export async function deletePerson(
  client: AnalyticsClient,
  projectId: string,
  personId: string,
): Promise<{ deleted: boolean }> {
  // F5: resolve the person's anonymous identities BEFORE removing the
  // links — their sessions_v2 rows are removed in the same atomic batch,
  // and the deletion is tombstones so a future identify with the same
  // external ID creates a FRESH person (late events from the deleted
  // identity can never attach to it).
  const linked = await client.execute({
    sql: "SELECT anonymous_id FROM anonymous_identities WHERE project_id = ? AND person_id = ?",
    args: [projectId, personId],
  });
  const anonIds = linked.rows.map((row) => String((row as { anonymous_id?: unknown }).anonymous_id ?? ""));
  // R3-F8: derive ALL person session ids from the project-scoped event
  // rows too — a user-ID-only session (no anonymous ID) is still removed.
  const sessionRows = await client.execute({
    sql: `SELECT DISTINCT session_id FROM events
          WHERE project_id = ? AND person_id = ? AND session_id IS NOT NULL`,
    args: [projectId, personId],
  });
  const sessionIds = sessionRows.rows.map((row) =>
    String((row as { session_id?: unknown }).session_id ?? ""),
  );
  const sessionStatements =
    anonIds.length > 0 || sessionIds.length > 0
      ? [
          {
            sql: `DELETE FROM sessions_v2 WHERE project_id = ? AND (${
              anonIds.length > 0
                ? `anonymous_id IN (${anonIds.map(() => "?").join(",")})`
                : "1 = 0"
            }${sessionIds.length > 0 ? ` OR session_id IN (${sessionIds.map(() => "?").join(",")})` : ""})`,
            args: [
              projectId,
              ...anonIds,
              ...sessionIds,
            ],
          },
        ]
      : [];
  // Task-15: error associations for the person's anonymous ids are removed
  // in the SAME atomic batch (occurrences, user links, users_affected
  // recount, then orphaned issues + their activity).
  const errorPurgeStatements = await personErrorPurgeStatements(
    client,
    projectId,
    anonIds,
  );
  // R7-F1: tombstone every linked credential so a stale post-deletion
  // event can never be reassigned into a later identity generation.
  const credentialTombstones = [
    ...(anonIds.length > 0
      ? anonIds.map((anonId) => ({
          sql: "INSERT INTO deleted_identities (project_id, kind, credential, deleted_at) VALUES (?, 'anonymous', ?, ?) ON CONFLICT DO NOTHING",
          args: [projectId, anonId, Date.now()],
        }))
      : []),
  ];
  const results = await client.batch?.(
    [
      ...credentialTombstones,
      ...sessionStatements,
      { sql: "DELETE FROM external_identities WHERE project_id = ? AND person_id = ?", args: [projectId, personId] },
      { sql: "DELETE FROM anonymous_identities WHERE project_id = ? AND person_id = ?", args: [projectId, personId] },
      { sql: "DELETE FROM person_traits WHERE project_id = ? AND person_id = ?", args: [projectId, personId] },
      { sql: "DELETE FROM events WHERE project_id = ? AND person_id = ?", args: [projectId, personId] },
      { sql: "DELETE FROM people WHERE project_id = ? AND person_id = ?", args: [projectId, personId] },
      { sql: "INSERT INTO deleted_people (project_id, person_id, deleted_at) VALUES (?, ?, ?) ON CONFLICT DO NOTHING", args: [projectId, personId, Date.now()] },
      ...errorPurgeStatements,
    ],
    "write",
  );
  // the `deleted` flag reflects the PERSON row removal — the tombstone
  // insert is not evidence that the person existed.
  const peopleDeleteIndex =
    credentialTombstones.length + sessionStatements.length + 4;
  const peopleDelete = results?.[peopleDeleteIndex];
  return { deleted: (peopleDelete?.rowsAffected ?? 0) > 0 };
}
