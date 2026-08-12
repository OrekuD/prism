/**
 * Analytics retention CLI (task-6 closure, task-9 slice 5 rework).
 *
 * Deletes expired analytics data from the store (Turso/libSQL):
 * - v2 `events` by `received_at` (server clock — the retention timestamp);
 * - v2 `sessions_v2` by `last_seen_at`;
 * - the legacy v1 `sessions` table by `created_at` when it still exists
 *   (until the read-path slice removes the v1 tables).
 *
 * Legacy tables are existence-guarded: a fresh migrations-only store has
 * no `sessions` table, and pre-migration legacy stores fail migration 001
 * loudly (the guarded reset is the escape hatch), so retention never
 * crashes on either shape.
 *
 * Every deletion happens in ONE atomic write batch (events before
 * sessions — dependents first), so a failure rolls back everything.
 *
 * Usage:
 *   yarn workspace prism-analytics-api retention --status    # config + counts (read-only)
 *   yarn workspace prism-analytics-api retention --dry-run   # what would be deleted
 *   yarn workspace prism-analytics-api retention             # apply deletion
 *
 * ANALYTICS_RETENTION_DAYS:
 *   unset or 0 disables deletion (the default — no surprise data loss);
 *   a positive integer enables batched deletion of expired rows.
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote stores).
 */
import { createClient, type Client, type InStatement } from "@libsql/client";
import { config } from "dotenv";
import { logger } from "./utils/logger.js";

config();

/** Parse ANALYTICS_RETENTION_DAYS; unset/empty/0 = disabled. Throws on invalid input. */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === "") return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `ANALYTICS_RETENTION_DAYS must be a non-negative integer, got "${raw}". Unset or 0 disables retention deletion.`,
    );
  }
  return value;
}

/** SQLite CURRENT_TIMESTAMP format (UTC) for a cutoff `days` ago (legacy v1 tables). */
export function retentionCutoff(days: number): string {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return cutoff.toISOString().replace("T", " ").slice(0, 19);
}

/** Epoch milliseconds cutoff (v2 tables store INTEGER ms timestamps). */
export function retentionCutoffMs(days: number): number {
  return Date.now() - days * 86_400_000;
}

export interface RetentionStats {
  enabled: boolean;
  retentionDays: number;
  /** v2 events (received_at) */
  events: { total: number; expired: number };
  /** v2 sessions (last_seen_at) */
  sessions: { total: number; expired: number };
  /** legacy v1 sessions (created_at) — 0 when the table is absent */
  legacySessions: { total: number; expired: number };
}

const countOf = (result: { rows: Array<Record<string, unknown>> }): number =>
  Number(result.rows[0]?.n ?? 0);

/** Existing table names (legacy tables are optional on fresh stores). */
export async function existingTables(client: Client): Promise<Set<string>> {
  const { rows } = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table'",
  );
  return new Set(rows.map((row) => String(row.name)));
}

export async function retentionStats(
  client: Client,
  days: number,
): Promise<RetentionStats> {
  const cutoff = retentionCutoff(days);
  const cutoffMs = retentionCutoffMs(days);
  const tables = await existingTables(client);
  const none = Promise.resolve({ rows: [{ n: 0 }] }) as never;

  const [events, sessions, legacySessions] = await Promise.all([
    Promise.all([
      client.execute("SELECT COUNT(*) AS n FROM events"),
      days > 0
        ? client.execute({
            sql: "SELECT COUNT(*) AS n FROM events WHERE received_at < ?",
            args: [cutoffMs],
          })
        : none,
    ]),
    Promise.all([
      tables.has("sessions_v2")
        ? client.execute("SELECT COUNT(*) AS n FROM sessions_v2")
        : none,
      days > 0 && tables.has("sessions_v2")
        ? client.execute({
            sql: "SELECT COUNT(*) AS n FROM sessions_v2 WHERE last_seen_at < ?",
            args: [cutoffMs],
          })
        : none,
    ]),
    Promise.all([
      tables.has("sessions")
        ? client.execute("SELECT COUNT(*) AS n FROM sessions")
        : none,
      days > 0 && tables.has("sessions")
        ? client.execute({
            sql: "SELECT COUNT(*) AS n FROM sessions WHERE created_at < ?",
            args: [cutoff],
          })
        : none,
    ]),
  ]);

  return {
    enabled: days > 0,
    retentionDays: days,
    events: { total: countOf(events[0]), expired: countOf(events[1]) },
    sessions: { total: countOf(sessions[0]), expired: countOf(sessions[1]) },
    legacySessions: { total: countOf(legacySessions[0]), expired: countOf(legacySessions[1]) },
  };
}

export interface RetentionResult {
  deletedEvents: number;
  deletedSessions: number;
  deletedLegacySessions: number;
}

/**
 * Delete expired rows in ONE atomic write batch, dependents first
 * (events before sessions — the v1 model links events to sessions).
 */
export async function applyRetention(
  client: Client,
  days: number,
): Promise<RetentionResult> {
  const empty: RetentionResult = {
    deletedEvents: 0,
    deletedSessions: 0,
    deletedLegacySessions: 0,
  };
  if (days <= 0) {
    return empty;
  }
  const cutoff = retentionCutoff(days);
  const cutoffMs = retentionCutoffMs(days);
  const tables = await existingTables(client);

  const statements: InStatement[] = [
    { sql: "DELETE FROM events WHERE received_at < ?", args: [cutoffMs] },
  ];
  if (tables.has("sessions_v2")) {
    statements.push({
      sql: "DELETE FROM sessions_v2 WHERE last_seen_at < ?",
      args: [cutoffMs],
    });
  }
  if (tables.has("sessions")) {
    statements.push({
      sql: "DELETE FROM sessions WHERE created_at < ?",
      args: [cutoff],
    });
  }
  if (statements.length === 1) {
    // only the v2 events delete applies
    const result = await client.execute(statements[0]);
    return {
      deletedEvents: result.rowsAffected,
      deletedSessions: 0,
      deletedLegacySessions: 0,
    };
  }

  const results = await client.batch(statements, "write");

  return {
    deletedEvents: results[0]?.rowsAffected ?? 0,
    deletedSessions: results[1]?.rowsAffected ?? 0,
    deletedLegacySessions:
      statements.length > 2 ? results[2]?.rowsAffected ?? 0 : 0,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const statusOnly = args.includes("--status");
  const dryRun = args.includes("--dry-run");

  const days = parseRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);

  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url) {
    logger.error("retention", "TURSO_DATABASE_URL is required");
    process.exit(1);
  }
  const authToken = process.env.TURSO_AUTH_TOKEN ?? "";
  const client = createClient({ url, authToken });

  const stats = await retentionStats(client, days);

  logger.info("retention", "status", stats as unknown as Record<string, unknown>);

  if (!stats.enabled) {
    logger.info(
      "retention",
      "disabled — ANALYTICS_RETENTION_DAYS is unset or 0, nothing was deleted",
    );
    process.exit(0);
  }

  if (statusOnly) {
    logger.info("retention", "status only — no deletion performed");
    process.exit(0);
  }

  if (dryRun) {
    logger.info(
      "retention",
      "dry run — would delete expired events and sessions, no deletion performed",
      {
        expiredEvents: stats.events.expired,
        expiredSessions: stats.sessions.expired,
        expiredLegacySessions: stats.legacySessions.expired,
        cutoff: retentionCutoff(days),
      },
    );
    process.exit(0);
  }

  const result = await applyRetention(client, days);
  logger.info("retention", "deletion applied", result);
  process.exit(0);
}

// Only run the CLI when executed directly (not when imported by tests).
const isMain =
  (process.argv[1] ?? "").endsWith("retention.ts") ||
  (process.argv[1] ?? "").endsWith("retention.js");
if (isMain) {
  main().catch((error) => {
    logger.error("retention", "failed", {
      message: error instanceof Error ? error.message : error,
    });
    process.exit(1);
  });
}
