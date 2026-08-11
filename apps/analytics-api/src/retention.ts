/**
 * Analytics retention CLI (task-6 closure).
 *
 * Deletes expired analytics data from the store (Turso/libSQL):
 * events are deleted before sessions, in one atomic batch.
 *
 * Usage:
 *   yarn workspace prism-analytics-api retention --status    # config + counts (read-only)
 *   yarn workspace prism-analytics-api retention --dry-run   # what would be deleted
 *   yarn workspace prism-analytics-api retention             # apply deletion
 *
 * ANALYTICS_RETENTION_DAYS:
 *   unset or 0 disables deletion (the default — no surprise data loss);
 *   a positive integer enables batched deletion of sessions (and their
 *   events) older than that many days.
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote stores).
 */
import { createClient, type Client } from '@libsql/client';
import { config } from 'dotenv';
import { logger } from './utils/logger';

config();

/** Parse ANALYTICS_RETENTION_DAYS; unset/empty/0 = disabled. Throws on invalid input. */
export function parseRetentionDays(raw: string | undefined): number {
  if (raw === undefined || raw.trim() === '') return 0;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(
      `ANALYTICS_RETENTION_DAYS must be a non-negative integer, got "${raw}". Unset or 0 disables retention deletion.`,
    );
  }
  return value;
}

/** SQLite CURRENT_TIMESTAMP format (UTC) for a cutoff `days` ago. */
export function retentionCutoff(days: number): string {
  const cutoff = new Date(Date.now() - days * 86_400_000);
  return cutoff.toISOString().replace('T', ' ').slice(0, 19);
}

export interface RetentionStats {
  enabled: boolean;
  retentionDays: number;
  totalSessions: number;
  totalEvents: number;
  expiredSessions: number;
  expiredEvents: number;
}

const countOf = (result: { rows: Array<Record<string, unknown>> }): number =>
  Number(result.rows[0]?.n ?? 0);

export async function retentionStats(
  client: Client,
  days: number,
): Promise<RetentionStats> {
  const cutoff = retentionCutoff(days);
  const [totalSessions, totalEvents, expiredSessions, expiredEvents] =
    await Promise.all([
      client.execute('SELECT COUNT(*) AS n FROM sessions'),
      client.execute('SELECT COUNT(*) AS n FROM events'),
      days > 0
        ? client.execute({
            sql: 'SELECT COUNT(*) AS n FROM sessions WHERE created_at < ?',
            args: [cutoff],
          })
        : Promise.resolve({ rows: [{ n: 0 }] } as never),
      days > 0
        ? client.execute({
            sql: 'SELECT COUNT(*) AS n FROM events WHERE created_at < ?',
            args: [cutoff],
          })
        : Promise.resolve({ rows: [{ n: 0 }] } as never),
    ]);

  return {
    enabled: days > 0,
    retentionDays: days,
    totalSessions: countOf(totalSessions),
    totalEvents: countOf(totalEvents),
    expiredSessions: countOf(expiredSessions),
    expiredEvents: countOf(expiredEvents),
  };
}

export interface RetentionResult {
  deletedSessions: number;
  deletedEvents: number;
}

/**
 * Delete expired events then expired sessions in one atomic batch
 * (`batch(…, "write")` is transactional in libSQL). No-op when disabled.
 */
export async function applyRetention(
  client: Client,
  days: number,
): Promise<RetentionResult> {
  if (days <= 0) return { deletedSessions: 0, deletedEvents: 0 };

  const cutoff = retentionCutoff(days);
  const results = await client.batch(
    [
      { sql: 'DELETE FROM events WHERE created_at < ?', args: [cutoff] },
      { sql: 'DELETE FROM sessions WHERE created_at < ?', args: [cutoff] },
    ],
    'write',
  );

  return {
    deletedEvents: results[0].rowsAffected,
    deletedSessions: results[1].rowsAffected,
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const statusOnly = args.includes('--status');
  const dryRun = args.includes('--dry-run');

  const days = parseRetentionDays(process.env.ANALYTICS_RETENTION_DAYS);

  const url = process.env.TURSO_DATABASE_URL ?? '';
  if (!url) {
    logger.error('retention', 'TURSO_DATABASE_URL is required');
    process.exit(1);
  }
  const authToken = process.env.TURSO_AUTH_TOKEN ?? '';
  const client = createClient({ url, authToken });

  const stats = await retentionStats(client, days);

  logger.info('retention', 'status', stats as unknown as Record<string, unknown>);

  if (!stats.enabled) {
    logger.info(
      'retention',
      'disabled — ANALYTICS_RETENTION_DAYS is unset or 0, nothing was deleted',
    );
    process.exit(0);
  }

  if (statusOnly) {
    logger.info('retention', 'status only — no deletion performed');
    process.exit(0);
  }

  if (dryRun) {
    logger.info(
      'retention',
      'dry run — would delete expired events and sessions, no deletion performed',
      {
        expiredEvents: stats.expiredEvents,
        expiredSessions: stats.expiredSessions,
        cutoff: retentionCutoff(days),
      },
    );
    process.exit(0);
  }

  const result = await applyRetention(client, days);
  logger.info('retention', 'deletion applied', result);
  process.exit(0);
}

// Only run the CLI when executed directly (not when imported by tests).
const isMain =
  (process.argv[1] ?? '').endsWith('retention.ts') ||
  (process.argv[1] ?? '').endsWith('retention.js');
if (isMain) {
  main().catch((error) => {
    logger.error('retention', 'failed', {
      message: error instanceof Error ? error.message : error,
    });
    process.exit(1);
  });
}
