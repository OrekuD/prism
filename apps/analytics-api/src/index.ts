import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { app, injectWebSocket } from "./app.js";

dotenv.config();

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8080;

const REQUIRED_ENV_VARS = [
  "AUTH_BASE_URL",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
] as const;

function validateEnvironment() {
  // Product database: DATABASE_URL (plain PostgreSQL, self-hosted) or the
  // full NEONDB_* set (hosted).
  const hasProductDb =
    Boolean(process.env.DATABASE_URL) ||
    [
      "NEONDB_PGHOST",
      "NEONDB_PGDATABASE",
      "NEONDB_PGUSER",
      "NEONDB_PGPASSWORD",
      "NEONDB_ENDPOINT_ID",
    ].every((key) => Boolean(process.env[key]));

  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);
  if (!hasProductDb) {
    missing.push("PRODUCT_DATABASE" as (typeof REQUIRED_ENV_VARS)[number]);
  }

  if (missing.length === 0) {
    return;
  }

  console.error(
    [
      "[prism-analytics-api] Missing required environment variables:",
      ...missing.map((key) => `  - ${key}`),
      "",
      "Copy apps/analytics-api/.env.example to apps/analytics-api/.env and fill in the values.",
    ].join("\n"),
  );
  process.exit(1);
}

validateEnvironment();

console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

injectWebSocket(server);
