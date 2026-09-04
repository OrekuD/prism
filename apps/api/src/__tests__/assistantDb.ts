/**
 * Ephemeral PostgreSQL for Slice 4 store tests (Task 21 slice 4).
 *
 * Boots a throwaway cluster with `initdb`/`pg_ctl`, applies the repo's
 * Drizzle migrations (including the assistant tables), and hands back a
 * `postgres-js` client — the same tagged-template shape controllers use.
 * This gives REAL transactional semantics: unique constraints, partial
 * unique indexes, FK cascades, and genuinely concurrent connections for
 * the race tests. No mocks, no fakes.
 *
 * Skipped gracefully when local Postgres binaries are unavailable
 * (`hasLocalPostgres()`), so unrelated environments never break.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";
import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";

const BIN_DIRS = [
  "/opt/homebrew/opt/postgresql@14/bin",
  "/opt/homebrew/opt/postgresql/bin",
  "/usr/lib/postgresql/14/bin",
  "/usr/lib/postgresql/15/bin",
  "/usr/lib/postgresql/16/bin",
  "/usr/local/pgsql/bin",
];

function binDir(): string | null {
  const fromPath = process.env.PG_BIN;
  if (fromPath && existsSync(path.join(fromPath, "initdb"))) return fromPath;
  for (const dir of BIN_DIRS) {
    if (existsSync(path.join(dir, "initdb"))) return dir;
  }
  return null;
}

export function hasLocalPostgres(): boolean {
  return binDir() !== null;
}

function run(
  file: string,
  args: string[],
  env?: Record<string, string>,
): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { env: { ...process.env, ...env } }, (error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (address && typeof address === "object") resolve(address.port);
        else reject(new Error("no port"));
      });
    });
  });
}

export type EphemeralPostgres = {
  /** Tagged-template client (ProductQuery-compatible call shape). */
  sql: ReturnType<typeof postgres>;
  stop: () => Promise<void>;
};

export async function startEphemeralPostgres(
  dbName = "assistant_test",
): Promise<EphemeralPostgres> {
  const dir = binDir();
  if (!dir) throw new Error("local postgres binaries not found");
  const root = await mkdtemp(path.join(os.tmpdir(), "prism-assistant-pg-"));
  const data = path.join(root, "data");
  const sock = path.join(root, "sock");
  await run(path.join(dir, "initdb"), [
    "-D",
    data,
    "-U",
    "postgres",
    "--auth=trust",
    "-E",
    "UTF8",
  ]);
  await mkdir(sock, { recursive: true });
  const port = await freePort();
  await run(path.join(dir, "pg_ctl"), [
    "-D",
    data,
    "-l",
    path.join(root, "log"),
    "-o",
    `-p ${port} -k ${sock} -c listen_addresses='127.0.0.1' -c max_connections='20' -c log_min_messages='FATAL'`,
    "start",
  ]);
  let stopped = false;
  const stop = async (): Promise<void> => {
    if (stopped) return;
    stopped = true;
    try {
      await sql.end({ timeout: 2 });
    } catch {
      // Client may already be closed.
    }
    try {
      await run(path.join(dir, "pg_ctl"), ["-D", data, "stop", "-m", "fast"]);
    } catch {
      // Best effort; the tmpdir is removed regardless.
    }
    await rm(root, { recursive: true, force: true });
  };
  const admin = postgres({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: "postgres",
    max: 1,
  });
  await admin.unsafe(`CREATE DATABASE "${dbName}"`);
  await admin.end();
  const sql = postgres({
    host: "127.0.0.1",
    port,
    user: "postgres",
    database: dbName,
    max: 10,
  });
  // Apply the repo's Drizzle migrations (product + assistant tables).
  const here = path.dirname(fileURLToPath(import.meta.url));
  const migrationsFolder = path.resolve(here, "../../drizzle");
  await migrate(drizzle(sql), { migrationsFolder });
  return { sql, stop };
}
