import { describe, expect, it, beforeAll } from 'vitest';
import { createClient, type Client } from '@libsql/client';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyRetention,
  parseRetentionDays,
  retentionCutoff,
  retentionStats,
} from '../retention';

/**
 * Retention tests (task-6 closure): a real libSQL :memory: client runs the
 * actual schema, so batch semantics and row counts match production.
 */

let client: Client;

const OLD_DAY = "datetime('now', '-10 days')";
const NEW_DAY = "datetime('now', '-1 day')";

async function seed(): Promise<void> {
  await client.execute(
    `INSERT INTO sessions (session_id, project_id, created_at)
     VALUES ('old-session', 'p1', ${OLD_DAY})`,
  );
  await client.execute(
    `INSERT INTO sessions (session_id, project_id, created_at)
     VALUES ('fresh-session', 'p1', ${NEW_DAY})`,
  );
  await client.execute(
    `INSERT INTO events (session_id, project_id, name, created_at)
     VALUES ('old-session', 'p1', 'old-event', ${OLD_DAY})`,
  );
  await client.execute(
    `INSERT INTO events (session_id, project_id, name, created_at)
     VALUES ('fresh-session', 'p1', 'fresh-event', ${NEW_DAY})`,
  );
}

beforeAll(async () => {
  client = createClient({ url: ':memory:' });
  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, '../../db/schema.sql');
  await client.executeMultiple(readFileSync(schemaPath, 'utf8'));
});

describe('parseRetentionDays', () => {
  it('unset/empty disables retention', () => {
    expect(parseRetentionDays(undefined)).toBe(0);
    expect(parseRetentionDays('')).toBe(0);
    expect(parseRetentionDays('0')).toBe(0);
  });

  it('accepts positive integers', () => {
    expect(parseRetentionDays('30')).toBe(30);
    expect(parseRetentionDays('7')).toBe(7);
  });

  it('rejects negatives, floats, and junk', () => {
    for (const bad of ['-1', '1.5', 'abc', '30 days']) {
      expect(() => parseRetentionDays(bad)).toThrow(/ANALYTICS_RETENTION_DAYS/);
    }
  });
});

describe('retentionCutoff', () => {
  it('formats SQLite datetime (UTC, seconds precision)', () => {
    expect(retentionCutoff(1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });
});

describe('applyRetention', () => {
  it('is a no-op when disabled (0 days)', async () => {
    await seed();
    const result = await applyRetention(client, 0);
    expect(result).toEqual({ deletedSessions: 0, deletedEvents: 0 });
    const stats = await retentionStats(client, 0);
    expect(stats.totalSessions).toBe(2);
    expect(stats.totalEvents).toBe(2);
  });

  it('reports expired counts without deleting (dry-run path)', async () => {
    const stats = await retentionStats(client, 7);
    expect(stats.enabled).toBe(true);
    expect(stats.expiredSessions).toBe(1); // old-session only
    expect(stats.expiredEvents).toBe(1); // old-event only
    // nothing deleted yet
    const after = await retentionStats(client, 30);
    expect(after.totalSessions).toBe(2);
    expect(after.totalEvents).toBe(2);
  });

  it('deletes events before sessions, keeps fresh data, and is idempotent', async () => {
    const result = await applyRetention(client, 7);
    expect(result).toEqual({ deletedEvents: 1, deletedSessions: 1 });

    const stats = await retentionStats(client, 7);
    expect(stats.totalSessions).toBe(1); // fresh-session remains
    expect(stats.totalEvents).toBe(1); // fresh-event remains
    expect(stats.expiredSessions).toBe(0);
    expect(stats.expiredEvents).toBe(0);

    // idempotent: nothing left to delete
    const again = await applyRetention(client, 7);
    expect(again).toEqual({ deletedEvents: 0, deletedSessions: 0 });
  });
});
