/**
 * Idempotent Turso/libSQL setup for the Prism analytics store.
 *
 * Run with: yarn workspace prism-analytics-api db:setup
 * Requires TURSO_DATABASE_URL and TURSO_AUTH_TOKEN in apps/analytics-api/.env.
 *
 * Unlike the legacy D1 path, this script never drops tables, so it is safe to
 * run against a database that already contains analytics data.
 */
import { createClient } from "@libsql/client";
import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";
import { logger } from "../utils/logger.js";

config();

const REQUIRED = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"] as const;

function main() {
  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    logger.error(
      "analytics:setup",
      "cannot set up the analytics database — copy apps/analytics-api/.env.example to apps/analytics-api/.env and fill in the values",
      { missing },
    );
    process.exit(1);
  }

  // The relative depth differs between source (src/database/../.. = app
  // root) and the built image (dist/src/database/../.. = dist/) — walk up
  // to the nearest db/schema.sql instead of hardcoding a depth.
  const here = dirname(fileURLToPath(import.meta.url));
  let dir = here;
  let schemaPath = "";
  for (let depth = 0; depth < 5; depth += 1) {
    const candidate = resolve(dir, "db/schema.sql");
    if (existsSync(candidate)) {
      schemaPath = candidate;
      break;
    }
    dir = resolve(dir, "..");
  }
  if (!schemaPath) {
    logger.error("analytics:setup", "db/schema.sql not found (is the package built?)");
    process.exit(1);
  }
  const schema = readFileSync(schemaPath, "utf8");

  // libSQL supports executing multiple statements in one call.
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });

  client
    .executeMultiple(schema)
    .then(() => {
      logger.info(
        "analytics:setup",
        "Analytics schema is up to date (sessions/events tables + indexes).",
      );
    })
    .catch((error) => {
      logger.error("analytics:setup", "analytics schema setup failed", {
        message: error instanceof Error ? error.message : error,
      });
      process.exit(1);
    })
    .finally(() => {
      client.close();
    });
}

main();
