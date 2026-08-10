import Server from "./Server";
import type { Bindings } from "hono/types";
import type { Event } from "@cloudflare/workers-types";
import { Resend } from "resend";
import { validatePrismConfig } from "./config";

async function main() {
  Server.startServer();
}

main();

/**
 * Fail fast with the central deployment validator. Messages name the
 * offending variables and remediation steps, never secret values.
 */
function validateEnvironment(env: Record<string, unknown>) {
  const problems = validatePrismConfig(env as Record<string, string | undefined>);
  if (problems.length === 0) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: "invalid_configuration",
      problems,
    }),
    { status: 500, headers: { "content-type": "application/json" } },
  );
}

export default {
  fetch: (
    request: Request,
    env: Record<string, unknown>,
    ctx: ExecutionContext,
  ) => {
    const error = validateEnvironment(env);
    if (error) {
      return error;
    }
    return Server.getInstance().fetch(request, env, ctx);
  },
  scheduled: (event: Event, env: Bindings, ctx: ExecutionContext) => {
    ctx.waitUntil(
      (async () => {
        console.log("Test", new Date().toISOString());
      })(),
    );
  },
};
