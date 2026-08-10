import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { app, injectWebSocket } from "./app.js";

dotenv.config();

const port = process.env.PORT ? Number.parseInt(process.env.PORT, 10) : 8080;

const REQUIRED_ENV_VARS = [
  "JWT_SECRET_KEY",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "NEONDB_PGHOST",
  "NEONDB_PGDATABASE",
  "NEONDB_PGUSER",
  "NEONDB_PGPASSWORD",
  "NEONDB_ENDPOINT_ID",
] as const;

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

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
