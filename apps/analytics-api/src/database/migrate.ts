/**
 * Analytics migrations CLI (task-9 §9, slice 5).
 *
 * Applies ordered forward migrations with a journal. Replaces the old
 * idempotent schema.sql setup script. Works for hosted Turso/libSQL and
 * packaged sqld (libsql protocol).
 *
 * Usage:
 *   yarn workspace prism-analytics-api db:migrate
 *
 * Requires TURSO_DATABASE_URL (and TURSO_AUTH_TOKEN for remote stores).
 */
import { config } from "dotenv";
import { logger } from "../utils/logger.js";
import { applyPendingMigrations, connectStore, readMigrationFiles } from "./migrations.js";

config();

async function main(): Promise<void> {
  const client = connectStore();
  const applied = await applyPendingMigrations(client, readMigrationFiles());
  logger.info(
    "analytics:migrate",
    applied.length === 0
      ? "schema is up to date — no migrations to apply"
      : `applied ${applied.length} migration(s)`,
    { applied: applied.map((m) => m.name) },
  );
  client.close();
}

main().catch((error) => {
  logger.error("analytics:migrate", "migration failed", {
    message: error instanceof Error ? error.message : error,
  });
  process.exit(1);
});
