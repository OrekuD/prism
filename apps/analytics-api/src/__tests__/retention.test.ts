import { describe, expect, it, beforeAll } from "vitest";
import { createClient, type Client } from "@libsql/client";
import { applyPendingMigrations, readMigrationFiles } from "../database/migrations";
import {
  applyRetention,
  parseRetentionDays,
  retentionCutoff,
  retentionCutoffMs,
  retentionStats,
} from "../retention";

/**
 * Retention tests (task-6 closure, task-9 slice 5): a real libSQL
 * :memory: client runs the ACTUAL ordered migrations, so table shapes,
 * batch semantics, and row counts match production. V2 tables use
 * INTEGER ms timestamps; the legacy v1 sessions table (TEXT created_at)
 * is exercised as the pre-read-path leftover it is.
 */

let client: Client;

const OLD_DAY_MS = Date.now() - 10 * 86_400_000;
const NEW_DAY_MS = Date.now() - 86_400_000;
const OLD_DAY = "datetime('now', '-10 days')";
const NEW_DAY = "datetime('now', '-1 day')";

async function seed(): Promise<void> {
  // v2 events (received_at INTEGER ms)
  await client.execute({
    sql: "INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at) VALUES ('old-event', 'p1', 'track', 'old', 2, ?, ?)",
    args: [OLD_DAY_MS, OLD_DAY_MS],
  });
  await client.execute({
    sql: "INSERT INTO events (id, project_id, type, name, schema_version, occurred_at, received_at) VALUES ('fresh-event', 'p1', 'track', 'fresh', 2, ?, ?)",
    args: [NEW_DAY_MS, NEW_DAY_MS],
  });
  // v2 sessions (last_seen_at INTEGER ms)
  await client.execute({
    sql: "INSERT INTO sessions_v2 (session_id, project_id, started_at, last_seen_at) VALUES ('old-session', 'p1', ?, ?)",
    args: [OLD_DAY_MS, OLD_DAY_MS],
  });
  await client.execute({
    sql: "INSERT INTO sessions_v2 (session_id, project_id, started_at, last_seen_at) VALUES ('fresh-session', 'p1', ?, ?)",
    args: [NEW_DAY_MS, NEW_DAY_MS],
  });
  // legacy v1 sessions (TEXT created_at) — recreated here because a
  // fresh migrations-only store has no `sessions` table (the legacy
  // leftover scenario retention must tolerate)
  await client.execute(
    `CREATE TABLE IF NOT EXISTS sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT NOT NULL,
      project_id TEXT NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`,
  );
  await client.execute(
    `INSERT INTO sessions (session_id, project_id, created_at)
     VALUES ('old-legacy', 'p1', ${OLD_DAY})`,
  );
  await client.execute(
    `INSERT INTO sessions (session_id, project_id, created_at)
     VALUES ('fresh-legacy', 'p1', ${NEW_DAY})`,
  );
}

beforeAll(async () => {
  client = createClient({ url: ":memory:" });
  await applyPendingMigrations(client, readMigrationFiles());
  await seed();
});

describe("parseRetentionDays", () => {
  it("unset/empty disables retention", () => {
    expect(parseRetentionDays(undefined)).toBe(0);
    expect(parseRetentionDays("")).toBe(0);
    expect(parseRetentionDays("0")).toBe(0);
  });

  it("accepts positive integers", () => {
    expect(parseRetentionDays("30")).toBe(30);
    expect(parseRetentionDays("7")).toBe(7);
  });

  it("rejects negatives, floats, and junk", () => {
    for (const bad of ["-1", "1.5", "abc", "30 days"]) {
      expect(() => parseRetentionDays(bad)).toThrow(/ANALYTICS_RETENTION_DAYS/);
    }
  });
});

describe("retentionCutoff", () => {
  it("formats SQLite datetime (UTC, seconds precision) for legacy tables", () => {
    expect(retentionCutoff(1)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it("returns epoch milliseconds for v2 tables", () => {
    const cutoff = retentionCutoffMs(1);
    expect(Number.isFinite(cutoff)).toBe(true);
    expect(cutoff).toBeLessThan(Date.now());
  });
});

describe("applyRetention", () => {
  it("is a no-op when disabled (0 days)", async () => {
    const result = await applyRetention(client, 0);
    expect(result).toEqual({
      deletedEvents: 0,
      deletedSessions: 0,
      deletedLegacySessions: 0,
    });
    const stats = await retentionStats(client, 0);
    expect(stats.events.total).toBe(2);
    expect(stats.sessions.total).toBe(2);
    expect(stats.legacySessions.total).toBe(2);
  });

  it("reports expired counts without deleting (dry-run path)", async () => {
    const stats = await retentionStats(client, 7);
    expect(stats.enabled).toBe(true);
    expect(stats.events.expired).toBe(1); // old-event only
    expect(stats.sessions.expired).toBe(1); // old-session only
    expect(stats.legacySessions.expired).toBe(1); // old-legacy only
    // nothing deleted yet
    const after = await retentionStats(client, 7);
    expect(after.events.total).toBe(2);
    expect(after.sessions.total).toBe(2);
    expect(after.legacySessions.total).toBe(2);
  });

  it("deletes expired v2 events, v2 sessions, and legacy sessions atomically", async () => {
    const result = await applyRetention(client, 7);
    expect(result).toEqual({
      deletedEvents: 1,
      deletedSessions: 1,
      deletedLegacySessions: 1,
    });
    const stats = await retentionStats(client, 7);
    expect(stats.events.total).toBe(1); // fresh-event survives
    expect(stats.events.expired).toBe(0);
    expect(stats.sessions.total).toBe(1); // fresh-session survives
    expect(stats.legacySessions.total).toBe(1); // fresh-legacy survives
  });

  it("is idempotent — a second apply deletes nothing", async () => {
    const second = await applyRetention(client, 7);
    expect(second).toEqual({
      deletedEvents: 0,
      deletedSessions: 0,
      deletedLegacySessions: 0,
    });
  });
});
