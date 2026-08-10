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
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "dotenv";

config();

const REQUIRED = ["TURSO_DATABASE_URL", "TURSO_AUTH_TOKEN"] as const;

function main() {
  const missing = REQUIRED.filter((key) => !process.env[key]);

  if (missing.length > 0) {
    console.error(
      [
        "[prism-analytics-api] Cannot set up the analytics database:",
        ...missing.map((key) => `  - ${key}`),
        "",
        "Copy apps/analytics-api/.env.example to apps/analytics-api/.env and fill in the values.",
      ].join("\n"),
    );
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const schemaPath = resolve(here, "../../db/schema.sql");
  const schema = readFileSync(schemaPath, "utf8");

  // libSQL supports executing multiple statements in one call.
  const client = createClient({
    url: process.env.TURSO_DATABASE_URL ?? "",
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });

  client
    .executeMultiple(schema)
    .then(() => {
      console.log(
        "[prism-analytics-api] Analytics schema is up to date (sessions/events tables + indexes).",
      );
    })
    .catch((error) => {
      console.error(
        "[prism-analytics-api] Analytics schema setup failed:",
        error,
      );
      process.exit(1);
    })
    .finally(() => {
      client.close();
    });
}

main();
