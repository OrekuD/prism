import { serve } from "@hono/node-server";
import dotenv from "dotenv";
import { app, injectWebSocket } from "./app.js";
import { logger } from "./utils/logger.js";

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

  logger.error(
    "analytics",
    "missing required environment variables — copy apps/analytics-api/.env.example to apps/analytics-api/.env and fill in the values",
    { missing },
  );
  process.exit(1);
}

validateEnvironment();

const server = serve(
  {
    fetch: app.fetch,
    port,
  },
  ({ port: listeningPort }) => {
    logger.info("analytics", "server running", { port: listeningPort });
  },
);

server.on("error", (error: NodeJS.ErrnoException) => {
  if (error.code === "EADDRINUSE") {
    logger.error(
      "analytics",
      "analytics port is already in use — stop the existing dev server or set PORT to a free port",
      { port, code: error.code },
    );
  } else {
    logger.error("analytics", "server failed to start", {
      port,
      code: error.code ?? "UNKNOWN",
      message: error.message,
    });
  }
  process.exitCode = 1;
});

injectWebSocket(server);
