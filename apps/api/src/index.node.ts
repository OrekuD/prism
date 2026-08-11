/**
 * Node server entry (task-6 section 2).
 *
 * Runs the same Hono application as the Cloudflare Worker on a plain Node
 * process with the postgres-js product database driver, for self-hosted
 * deployments and local development without wrangler.
 *
 *   PORT=8787 DATABASE_URL=postgres://… node dist/index.node.js
 *   (development: yarn workspace prism-api dev:node)
 *
 * Configuration comes from the environment (.env via dotenv). Validation
 * fails fast with variable names + remediation, never secret values.
 */
import { config as loadDotenv } from "dotenv";
import { serve } from "@hono/node-server";
import Server from "./Server";
import { validatePrismConfig } from "./config";
import { createPostgresProductDb } from "./database/db";
import { setRuntimeAdapter } from "./runtime";
import { logger } from "./utils/logger";

loadDotenv();

setRuntimeAdapter({ createProductDb: createPostgresProductDb });

const env = process.env as Record<string, string | undefined>;

const problems = validatePrismConfig(env);
if (problems.length > 0) {
  logger.error("api", "configuration invalid", {
    problems: problems.map((p) => `  - ${p}`),
  });
  process.exit(1);
}

Server.startServer();

const port = Number.parseInt(env.PORT ?? "8787", 10);

serve({
  fetch: (request) =>
    Server.getInstance().fetch(
      request,
      env,
      // Structural shim for the Worker ExecutionContext (runtime.ts seam).
      {
        waitUntil: () => undefined,
        passThroughOnException: () => undefined,
      } as never,
    ),
  port,
});

logger.info("api", "node server listening", { url: `http://localhost:${port}` });
