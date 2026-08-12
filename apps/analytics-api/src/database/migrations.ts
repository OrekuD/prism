import { createClient, type Client } from "@libsql/client";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { logger } from "../utils/logger.js";

/**
 * Ordered analytics migrations (task-9 §9): forward migrations are the
 * production contract — the journal (`schema_migrations`) records applied
 * versions, each migration runs atomically in one write batch, and the
 * runner works identically for hosted Turso/libSQL and packaged sqld
 * (both speak the libsql protocol).
 *
 * This replaces the old idempotent schema.sql setup script. A separate
 * GUARDED reset command exists for disposable development/test stores
 * (src/database/reset.ts).
 */

export interface Migration {
  readonly version: number;
  readonly name: string;
  readonly sql: string;
}

/** Directory of ordered `NNN_name.sql` migration files. */
export function resolveMigrationsDir(): string {
  // The relative depth differs between source (src/database/../.. = package
  // root) and the built image (dist/src/database/../../.. = package root) —
  // walk up to the nearest db/migrations instead of hardcoding a depth.
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let depth = 0; depth < 6; depth += 1) {
    const candidate = resolve(dir, "db/migrations");
    if (existsSync(candidate)) return candidate;
    dir = resolve(dir, "..");
  }
  throw new Error("db/migrations not found (is the package built?)");
}

export const MIGRATIONS_DIR = resolveMigrationsDir();

/** Read + sort the migration files (version prefix is the order key). */
export function readMigrationFiles(dir = MIGRATIONS_DIR): Migration[] {
  const files = readdirSync(dir)
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();
  return files.map((file) => {
    const version = Number.parseInt(file.split("_")[0] ?? "0", 10);
    if (!Number.isInteger(version) || version <= 0) {
      throw new Error(`invalid migration filename: ${file}`);
    }
    return {
      version,
      name: file,
      sql: readFileSync(resolve(dir, file), "utf8"),
    };
  });
}

/** Create the journal table if absent. */
export async function ensureJournal(client: Client): Promise<void> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
}

/**
 * Apply every pending migration in version order. Each migration's
 * statements + its journal row run in ONE write batch, so a failing
 * migration rolls back completely (no partial schema, no journal row).
 * Returns the migrations that were applied. Idempotent: applied versions
 * are never re-run.
 */
export async function applyPendingMigrations(
  client: Client,
  migrations: Migration[],
): Promise<Migration[]> {
  await ensureJournal(client);
  const { rows } = await client.execute("SELECT version FROM schema_migrations");
  const applied = new Set(rows.map((row) => Number(row.version)));
  const pending = migrations
    .filter((migration) => !applied.has(migration.version))
    .sort((a, b) => a.version - b.version);

  for (const migration of pending) {
    // Strip `--` comment lines BEFORE splitting on `;` — migration headers
    // contain prose with semicolons. (Migrations must not use `--` inside
    // string literals; the current files are simple DDL.)
    const sql = migration.sql
      .split("\n")
      .map((line) => line.replace(/--.*$/, ""))
      .filter((line) => line.trim().length > 0)
      .join("\n");
    const statements = sql
      .split(";")
      .map((statement) => statement.trim())
      .filter((statement) => statement.length > 0);
    if (statements.length === 0) {
      throw new Error(`migration ${migration.version} (${migration.name}) is empty`);
    }
    await client.batch(
      [
        ...statements.map((sql) => ({ sql })),
        {
          sql: "INSERT INTO schema_migrations (version, name) VALUES (?, ?)",
          args: [migration.version, migration.name],
        },
      ],
      "write",
    );
    logger.info("analytics:migrate", "migration applied", {
      version: migration.version,
      name: migration.name,
    });
  }
  return pending;
}

/** Connect using the standard analytics store environment. */
export function connectStore(): Client {
  const url = process.env.TURSO_DATABASE_URL ?? "";
  if (!url) {
    logger.error("analytics:migrate", "TURSO_DATABASE_URL is required");
    process.exit(1);
  }
  return createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });
}

// Only run the CLI when executed directly (not when imported by tests).
const isMain =
  (process.argv[1] ?? "").endsWith("migrations.ts") ||
  (process.argv[1] ?? "").endsWith("migrations.js");
if (isMain) {
  config();
  const client = connectStore();
  applyPendingMigrations(client, readMigrationFiles())
    .then((applied) => {
      logger.info(
        "analytics:migrate",
        applied.length === 0
          ? "schema is up to date — no migrations to apply"
          : `applied ${applied.length} migration(s)`,
        { applied: applied.map((m) => m.name) },
      );
    })
    .catch((error) => {
      logger.error("analytics:migrate", "migration failed", {
        message: error instanceof Error ? error.message : error,
      });
      process.exit(1);
    })
    .finally(() => client.close());
}
