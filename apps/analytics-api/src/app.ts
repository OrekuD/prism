import { createNodeWebSocket } from "@hono/node-ws";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import WebSocketManager from "./managers/WebSocketManager.js";
import Router from "./routers/Router.js";
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
// /api/v1/analytics/* endpoint regardless of the key in use.
app.use("/api/v1/*", rateLimitMiddleware(ingestionLimiter));

app.route("api/v1", Router);

app.get("/test", async (ctx) => {
  const test = { message: "ok" };
  return ctx.text("Hello Test!");
});
