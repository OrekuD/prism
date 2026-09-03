import type { EventResource, ProjectDetailedRequest, ProjectDetailedResource } from "@prism-analytics/types";

/**
 * Bounded v2 analytics reads (task-9 slice 6): all dashboard aggregates
 * are computed in the database (parameterized, project-scoped, date-
 * bounded) instead of loading every session row into application memory.
 *
 * Honest semantics:
 * - "sessions" = accepted `session_started` events (client-owned session
 *   IDs); the dashboard labels these "Sessions", never "Visitors".
 * - desktop/mobile split comes from the context `kind` field; unknown
 *   kinds count as desktop (never mislabeled as mobile).
 * - browser/OS/country stats have NO v2 source (the WireContext allowlist
 *   carries no browser/OS/geo fields) and were removed from the resource
 *   — the dashboard renders no fabricated rankings.
 * - properties are DECODED at this boundary into typed JSON values; a
 *   malformed value yields null rather than a raw string or an error.
 */

const DAY_MS = 86_400_000;

/** Date-window for a dashboard duration selection (default: 3 months). */
export function durationWindowMs(
  duration: ProjectDetailedRequest["duration"],
): number {
  switch (duration) {
    case "24-hours":
      return DAY_MS;
    case "seven-days":
      return 7 * DAY_MS;
    case "two-weeks":
      return 14 * DAY_MS;
    case "one-month":
      return 30 * DAY_MS;
    case "one-year":
      return 365 * DAY_MS;
    default:
      return 90 * DAY_MS;
  }
}

interface AnalyticsClient {
  execute(input: {
    sql: string;
    args: Array<string | number | null>;
  }): Promise<{ rows: Array<Record<string, unknown>> }>;
}

const DAY_EXPR = "date(received_at / 1000, 'unixepoch')";
const MOBILE_CASE = "SUM(CASE WHEN json_extract(context, '$.kind') = 'mobile' THEN 1 ELSE 0 END)";
const DESKTOP_CASE =
  "SUM(CASE WHEN COALESCE(json_extract(context, '$.kind'), 'web') != 'mobile' THEN 1 ELSE 0 END)";

type DayCount = { date: string; desktop: number; mobile: number };

/**
 * Per-day session counts over a date window for one project (or several —
 * grouped by project_id when `projectIds` has more than one entry).
 */
export async function dailySessionSummary(
  client: AnalyticsClient,
  projectIds: string[],
  sinceMs: number,
): Promise<Array<{ projectId: string; days: DayCount[] }>> {
  if (projectIds.length === 0) return [];
  const placeholders = projectIds.map(() => "?").join(",");
  const { rows } = await client.execute({
    sql: `SELECT project_id, ${DAY_EXPR} AS day, ${MOBILE_CASE} AS mobile, ${DESKTOP_CASE} AS desktop
          FROM events
          WHERE project_id IN (${placeholders})
            AND name = 'session_started'
            AND received_at >= ?
          GROUP BY project_id, day
          ORDER BY day`,
    args: [...projectIds, sinceMs],
  });

  const byProject = new Map<string, DayCount[]>();
  for (const row of rows) {
    const projectId = String(row.project_id);
    const days = byProject.get(projectId) ?? [];
    days.push({
      date: String(row.day),
      desktop: Number(row.desktop ?? 0),
      mobile: Number(row.mobile ?? 0),
    });
    byProject.set(projectId, days);
  }
  return projectIds.map((projectId) => ({
    projectId,
    days: byProject.get(projectId) ?? [],
  }));
}

/** Desktop/mobile session counts over a window for one project. */
export async function deviceSessionCounts(
  client: AnalyticsClient,
  projectId: string,
  sinceMs: number,
): Promise<{ desktop: number; mobile: number }> {
  const { rows } = await client.execute({
    sql: `SELECT ${MOBILE_CASE} AS mobile, ${DESKTOP_CASE} AS desktop
          FROM events
          WHERE project_id = ? AND name = 'session_started' AND received_at >= ?`,
    args: [projectId, sinceMs],
  });
  const row = rows[0] ?? {};
  return {
    desktop: Number(row.desktop ?? 0),
    mobile: Number(row.mobile ?? 0),
  };
}

/** Decode stored JSON at the API boundary into a typed JSON value. */
function decodeProperties(raw: unknown): Record<string, unknown> | null {
  if (raw === null || raw === undefined || raw === "") return null;
  try {
    const parsed = JSON.parse(String(raw)) as unknown;
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/** v2 event listing (bounded, newest first). */
/**
 * Task 16 Events UI: the stored event model surfaced for the dashboard.
 * Every field is trusted storage (source_id/platform were derived from the
 * ingestion key at ingestion); identity/context/SDK are nullable because
 * older rows pre-date those columns.
 */
export async function projectEvents(
  client: AnalyticsClient,
  projectId: string,
  limit = 200,
): Promise<EventResource[]> {
  const { events } = await paginatedProjectEvents(client, projectId, { limit });
  return events;
}

/** Cursor helpers for keyset pagination on (received_at DESC, id DESC). */
function encodeEventCursor(cursor: { receivedAt: number; id: string }): string {
  const json = JSON.stringify([cursor.receivedAt, cursor.id]);
  if (typeof Buffer !== "undefined") {
    return (Buffer as unknown as { from(s: string): { toString(e: string): string } }).from(json).toString("base64url");
  }
  const b64 = btoa(json);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeEventCursor(cursor: string): { receivedAt: number; id: string } | null {
  try {
    let json: string;
    if (typeof Buffer !== "undefined") {
      json = (Buffer as unknown as { from(s: string, e: string): { toString(e: string): string } }).from(cursor, "base64url").toString("utf8");
    } else {
      let b64 = cursor.replace(/-/g, "+").replace(/_/g, "/");
      while (b64.length % 4) b64 += "=";
      json = atob(b64);
    }
    const parsed = JSON.parse(json) as unknown;
    if (!Array.isArray(parsed) || parsed.length !== 2) return null;
    const [receivedAt, id] = parsed as [unknown, unknown];
    if (typeof receivedAt !== "number" || typeof id !== "string") return null;
    if (!Number.isFinite(receivedAt) || id.length === 0) return null;
    return { receivedAt, id };
  } catch {
    return null;
  }
}

export type PaginatedProjectEventsParams = {
  cursor?: string;
  limit?: number;
  q?: string;
  sourceId?: string;
  platformFamily?: "web" | "mobile" | "server";
  /** Canonical resolved range (Task 21 slice 2): half-open on occurred_at. */
  from?: number;
  to?: number;
  /** Snapshot cutoff: rows received after `asOf` are excluded. */
  asOf?: number;
};

export async function paginatedProjectEvents(
  client: AnalyticsClient,
  projectId: string,
  params: PaginatedProjectEventsParams = {},
): Promise<{ events: EventResource[]; nextCursor: string | null }> {
  const limit = Math.min(Math.max(params.limit ?? 50, 1), 100);
  const clauses: string[] = ["project_id = ?"];
  const args: Array<string | number | null> = [projectId];

  if (params.q && params.q.trim().length > 0) {
    const term = `%${params.q.trim()}%`;
    // Search event name + source name via post-hydration? For now server searches name only (LIKE is case-insensitive in SQLite for ASCII).
    clauses.push("lower(name) LIKE lower(?)");
    args.push(term);
  }
  if (params.sourceId) {
    clauses.push("source_id = ?");
    args.push(params.sourceId);
  }
  if (params.platformFamily) {
    if (params.platformFamily === "web") {
      clauses.push("platform = 'web'");
    } else if (params.platformFamily === "server") {
      clauses.push("platform = 'server'");
    } else if (params.platformFamily === "mobile") {
      clauses.push("platform IN ('ios','android','react-native')");
    }
  }
  if (params.from !== undefined) {
    clauses.push("occurred_at >= ?");
    args.push(params.from);
  }
  if (params.to !== undefined) {
    clauses.push("occurred_at < ?");
    args.push(params.to);
  }
  if (params.asOf !== undefined) {
    clauses.push("received_at <= ?");
    args.push(params.asOf);
  }

  if (params.cursor) {
    const decoded = decodeEventCursor(params.cursor);
    if (decoded) {
      clauses.push("((received_at < ?) OR (received_at = ? AND id < ?))");
      args.push(decoded.receivedAt, decoded.receivedAt, decoded.id);
    }
  }

  const where = clauses.join(" AND ");
  const { rows } = await client.execute({
    sql: `SELECT id, session_id, project_id, name, type, properties, context,
                 occurred_at, received_at, schema_version,
                 anonymous_id, user_id, person_id,
                 source_id, platform, sdk_name, sdk_version
          FROM events
          WHERE ${where}
          ORDER BY received_at DESC, id DESC
          LIMIT ?`,
    args: [...args, limit + 1],
  });

  const hasMore = rows.length > limit;
  const pageRows = hasMore ? rows.slice(0, limit) : rows;
  const last = pageRows[pageRows.length - 1];
  const nextCursor =
    hasMore && last
      ? encodeEventCursor({
          receivedAt: Number((last as Record<string, unknown>).received_at),
          id: String((last as Record<string, unknown>).id),
        })
      : null;

  const events = pageRows.map((row) => ({
    id: String(row.id),
    sessionId: row.session_id === null || row.session_id === undefined
      ? null
      : String(row.session_id),
    projectId: String(row.project_id),
    name: String(row.name),
    type: row.type === null || row.type === undefined ? "track" : String(row.type),
    properties: decodeProperties(row.properties),
    context: decodeProperties(row.context),
    occurredAt: Number(row.occurred_at),
    receivedAt: Number(row.received_at),
    schemaVersion: Number(row.schema_version),
    anonymousId:
      row.anonymous_id === null || row.anonymous_id === undefined
        ? null
        : String(row.anonymous_id),
    userId:
      row.user_id === null || row.user_id === undefined
        ? null
        : String(row.user_id),
    personId:
      row.person_id === null || row.person_id === undefined
        ? null
        : String(row.person_id),
    sourceId:
      row.source_id === null || row.source_id === undefined
        ? null
        : String(row.source_id),
    platform:
      row.platform === null || row.platform === undefined
        ? null
        : String(row.platform),
    sdkName:
      row.sdk_name === null || row.sdk_name === undefined
        ? null
        : String(row.sdk_name),
    sdkVersion:
      row.sdk_version === null || row.sdk_version === undefined
        ? null
        : String(row.sdk_version),
  }));

  return { events, nextCursor };
}

/** The full bounded analytics payload for the project page. */
export async function projectAnalytics(
  client: AnalyticsClient,
  projectId: string,
  duration: ProjectDetailedRequest["duration"],
): Promise<ProjectDetailedResource["analytics"]> {
  const sinceMs = Date.now() - durationWindowMs(duration);
  const [summary, device] = await Promise.all([
    dailySessionSummary(client, [projectId], sinceMs),
    deviceSessionCounts(client, projectId, sinceMs),
  ]);
  return {
    summary: summary[0]?.days ?? [],
    device,
  };
}
