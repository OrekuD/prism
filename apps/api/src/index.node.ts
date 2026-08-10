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

loadDotenv();

setRuntimeAdapter({ createProductDb: createPostgresProductDb });

const env = process.env as Record<string, string | undefined>;

const problems = validatePrismConfig(env);
if (problems.length > 0) {
  console.error(
    ["[prism-api] Configuration is invalid:", ...problems.map((p) => `  - ${p}`)].join(
      "\n",
    ),
  );
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

console.log(`[prism-api] Node server listening on http://localhost:${port}`);
