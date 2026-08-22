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
  const { rows } = await client.execute({
    sql: `SELECT id, session_id, project_id, name, type, properties, context,
                 occurred_at, received_at, schema_version,
                 anonymous_id, user_id, person_id,
                 source_id, platform, sdk_name, sdk_version
          FROM events
          WHERE project_id = ?
          ORDER BY received_at DESC, id DESC
          LIMIT ?`,
    args: [projectId, limit],
  });
  return rows.map((row) => ({
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
