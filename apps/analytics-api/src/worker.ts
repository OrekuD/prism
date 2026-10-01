import { createHttpApp, rateLimitMiddleware, websocketLimiter } from "./httpApp.js";
import NeonDatabaseManager from "./managers/NeonDatabaseManager.js";
import { JwtVerifier } from "./services/JwtVerifier.js";
import { logger } from "./utils/logger.js";
import { LiveProject } from "./worker/LiveProject.js";

export { LiveProject };

interface WorkerEnv {
  LIVE_PROJECT: DurableObjectNamespace<LiveProject>;
  DATABASE_URL: string;
  TURSO_DATABASE_URL: string;
  TURSO_AUTH_TOKEN: string;
  ANALYTICS_INSTALLATION_SALT: string;
  AUTH_BASE_URL: string;
}

const projectIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const app = createHttpApp((ctx, projectId, message) => {
  const room = (ctx.env as WorkerEnv).LIVE_PROJECT.getByName(projectId);
  ctx.executionCtx.waitUntil(
    room.broadcast(message).catch(() => {
      logger.warn("analytics:live", "session broadcast failed", { projectId });
    }),
  );
});

app.get("/ws", rateLimitMiddleware(websocketLimiter), async (ctx) => {
  const ids = new URL(ctx.req.url).searchParams.getAll("projectId");
  if (
    ctx.req.header("Upgrade")?.toLowerCase() !== "websocket" ||
    ids.length !== 1 ||
    !projectIdPattern.test(ids[0] ?? "")
  ) {
    return ctx.text("Invalid WebSocket request", 400);
  }
  const protocols = ctx.req.header("Sec-WebSocket-Protocol")?.split(",").map((value) => value.trim()) ?? [];
  const tokens = protocols.filter((value) => value.startsWith("prism.jwt."));
  if (protocols.includes("prism") === false || tokens.length !== 1 || tokens[0].length > 8200) {
    return ctx.text("Unauthorized", 401);
  }
  const verified = await JwtVerifier.verify(
    tokens[0].slice("prism.jwt.".length),
    `${(ctx.env as WorkerEnv).AUTH_BASE_URL.replace(/\/$/, "")}/api/auth/jwks`,
  );
  if (!verified?.sub || typeof verified.exp !== "number" || verified.exp * 1000 <= Date.now()) {
    return ctx.text("Unauthorized", 401);
  }
  try {
    const projects = await NeonDatabaseManager.forRequest(ctx)`
      SELECT p.id FROM projects p
      JOIN member m ON m.organization_id = p.organization_id
      WHERE p.id = ${ids[0]} AND m.user_id = ${verified.sub} LIMIT 1
    `;
    if (projects.length === 0) return ctx.text("Not found", 404);
  } catch {
    return ctx.text("Live unavailable", 503);
  }
  return (ctx.env as WorkerEnv).LIVE_PROJECT.getByName(ids[0]).fetch(ctx.req.raw);
});

export default {
  fetch(request: Request, env: WorkerEnv, executionCtx: ExecutionContext) {
    if (
      new URL(request.url).pathname !== "/health/live" &&
      (!env.DATABASE_URL || !env.TURSO_DATABASE_URL || !env.TURSO_AUTH_TOKEN ||
        !env.ANALYTICS_INSTALLATION_SALT || !env.AUTH_BASE_URL)
    ) {
      return new Response("analytics worker not configured", { status: 503 });
    }
    return app.fetch(request, env, executionCtx);
  },
};
