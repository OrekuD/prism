import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import TursoDatabaseManager from "./managers/TursoDatabaseManager.js";
import { ErrorResponse } from "./network/responses/ErrorResponse.js";
import ErrorIngestRouter from "./routers/ErrorIngestRouter.js";
import IngestRouter from "./routers/IngestRouter.js";
import { RateLimiter, clientIpFrom } from "./utils/RateLimiter.js";

// Keep this in step with db/migrations; the Node migration test checks it.
export const LATEST_MIGRATION_VERSION = 13;

export const ingestionLimiter = new RateLimiter(60_000, 120);
export const websocketLimiter = new RateLimiter(60_000, 30);

export const rateLimitMiddleware = (limiter: RateLimiter) =>
  createMiddleware(async (ctx, next) => {
    const { allowed, retryAfterSeconds } = limiter.hit(clientIpFrom(ctx));
    if (!allowed) {
      ctx.header("Retry-After", String(retryAfterSeconds));
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }
    await next();
  });

export function createHttpApp(
  broadcast: (ctx: Context, projectId: string, message: string) => void,
) {
  const app = new Hono();
  app.use("/*", cors());
  app.use("/*", createMiddleware(async (ctx, next) => {
    ctx.set("broadcastSessionStarted", (projectId: string, message: string) =>
      broadcast(ctx, projectId, message));
    await next();
  }));

  app.get("/", (ctx) => ctx.text("Waguan!"));
  app.get("/health/live", (ctx) => ctx.text("ok"));
  app.get("/health/ready", async (ctx) => {
    try {
      const client = TursoDatabaseManager.getInstance(ctx);
      const journal = await client.execute(
        "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
      );
      if (Number(journal.rows[0]?.version ?? 0) < LATEST_MIGRATION_VERSION) {
        return ctx.text("analytics store not migrated", 503);
      }
      await client.execute("SELECT 1 FROM sessions_v2 LIMIT 1");
      return ctx.text("ok");
    } catch {
      return ctx.text("analytics store unavailable", 503);
    }
  });

  app.use("/api/v2/*", rateLimitMiddleware(ingestionLimiter));
  app.route("api/v2", IngestRouter);
  app.use("/api/v1/errors/*", rateLimitMiddleware(ingestionLimiter));
  app.route("api/v1/errors", ErrorIngestRouter);
  return app;
}
