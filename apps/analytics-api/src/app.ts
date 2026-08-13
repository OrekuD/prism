import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import WebSocketManager from "./managers/WebSocketManager.js";
import TursoDatabaseManager from "./managers/TursoDatabaseManager.js";
import IngestRouter from "./routers/IngestRouter.js";
import { latestMigrationVersion } from "./database/migrations.js";
import { ErrorResponse } from "./network/responses/ErrorResponse.js";
import { RateLimiter, clientIpFrom } from "./utils/RateLimiter.js";

export const app = new Hono();

export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

// Public ingestion CORS policy: the browser SDK runs on customer sites and
// posts cross-origin, so ingestion intentionally allows any origin. The
// request is authenticated by the project API key; the key is a public
// identifier restricted to ingestion only (see README security model).
app.use("/*", cors());

// Soft per-IP limits (in-memory, per-process).
export const ingestionLimiter = new RateLimiter(60_000, 120); // 120 req/min
export const websocketLimiter = new RateLimiter(60_000, 30); // 30 upgrades/min

const rateLimitMiddleware = (limiter: RateLimiter) =>
  createMiddleware(async (ctx, next) => {
    const { allowed, retryAfterSeconds } = limiter.hit(clientIpFrom(ctx));
    if (!allowed) {
      ctx.header("Retry-After", String(retryAfterSeconds));
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }
    await next();
  });

app.get("/", (ctx) => {
  return ctx.text("Waguan!");
});

// Readiness (task-9 §8, release review): /health/live is process
// health; /health/ready verifies the store is FULLY migrated — the
// journal's latest version AND the sessions_v2 table must exist (an
// events-only store is not ready). Optional enrichment is NEVER a
// readiness dependency.
app.get("/health/live", (ctx) => {
  return ctx.text("ok");
});
app.get("/health/ready", async (ctx) => {
  try {
    const journal = await TursoDatabaseManager.instance.execute(
      "SELECT version FROM schema_migrations ORDER BY version DESC LIMIT 1",
    );
    const latest = Number(journal.rows[0]?.version ?? 0);
    if (latest < latestMigrationVersion()) {
      return ctx.text("analytics store not migrated", 503);
    }
    await TursoDatabaseManager.instance.execute(
      "SELECT 1 FROM sessions_v2 LIMIT 1",
    );
    return ctx.text("ok");
  } catch {
    return ctx.text("analytics store unavailable", 503);
  }
});

app.get(
  "/ws",
  rateLimitMiddleware(websocketLimiter),
  upgradeWebSocket(() => ({
    onOpen(event, ws) {
      return WebSocketManager.onConnect(event, ws);
    },
    async onMessage(event, ws) {
      return await WebSocketManager.onMessage(event, ws);
    },
    onClose(event, ws) {
      return WebSocketManager.onClose(ws);
    },
  })),
);

// Per-IP ingestion throttle applied before routing so it covers every
// /api/v2/* ingestion endpoint regardless of the key in use. (The v1
// /api/v1/analytics/* routes were removed in task-9 slice 6.)
app.use("/api/v2/*", rateLimitMiddleware(ingestionLimiter));

app.route("api/v2", IngestRouter);


