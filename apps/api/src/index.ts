import Server from "./Server";
import type { Bindings } from "hono/types";
import type { Event } from "@cloudflare/workers-types";
import { Resend } from "resend";

async function main() {
  Server.startServer();
}

main();

/**
 * Fail fast with a useful message when required bindings are missing.
 * Optional secrets (RESEND_API_KEY, IMAGE_KIT_API_KEY, IP_INFO_API_TOKEN) are
 * only required by the flows that use them and are therefore not checked.
 */
function validateEnvironment(env: Record<string, unknown>) {
  const missing = ["DATABASE_URL", "JWT_SECRET_KEY", "CLIENT_URL"].filter(
    (key) => !env[key],
  );

  if (missing.length === 0) {
    return null;
  }

  return new Response(
    JSON.stringify({
      error: "missing_environment",
      missing,
      hint: "Copy apps/api/.dev.vars.example to apps/api/.dev.vars and fill in the values.",
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
