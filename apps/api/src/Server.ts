import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { router as Router } from "./routers/Router";
import type { Bindings, HonoConfig } from "./types/types";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { getAuth } from "./auth/auth";
import { ErrorResponse } from "./network/responses/ErrorResponse";
import { RateLimiter, clientIpFrom } from "./utils/RateLimiter";

// Soft per-IP throttle for all Better Auth endpoints (signup, sign-in, OTP,
// reset, social callbacks). In-memory, per isolate — production enforcement
// needs a shared store (see README security model).
export const authRateLimiter = new RateLimiter(60_000, 20);

const authRateLimit = createMiddleware(async (ctx, next) => {
  const { allowed, retryAfterSeconds } = authRateLimiter.hit(clientIpFrom(ctx));
  if (!allowed) {
    ctx.header("Retry-After", String(retryAfterSeconds));
    return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
  }
  await next();
});

class Server {
  private instance: OpenAPIHono<HonoConfig>;
  private started = false;

  constructor() {
    // this.instance = new Hono();
    this.instance = new OpenAPIHono();
  }

  public startServer() {
    if (this.started) {
      return;
    }
    this.started = true;

    this.instance.get("/", async (ctx) => {
      return ctx.text("Waguan");
    });

    /**
     * Better Auth: cookie sessions, email/password, social providers, and
     * the JWT/JWKS service-token endpoints under /api/auth/*.
     * CORS with credentials must allow the dashboard origin explicitly.
     */
    this.instance.use(
      "/api/auth/*",
      cors({
        origin: (origin, c) => {
          const env = c.env as Bindings;
          const allowed = [
            env.CLIENT_URL,
            ...(env.CORS_ALLOWED_ORIGINS ?? "")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          ].filter(Boolean);

          if (!origin) {
            return "*";
          }
          if (allowed.includes(origin)) {
            return origin;
          }
          return null;
        },
        credentials: true,
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 86400,
      }),
    );
    this.instance.use("/api/auth/*", authRateLimit);
    this.instance.all("/api/auth/*", (ctx) => {
      const auth = getAuth(ctx.env);
      return auth.handler(ctx.req.raw);
    });

    // Public provider inventory so the UI can hide unavailable buttons.
    this.instance.get("/api/auth/providers", (ctx) => {
      const env = ctx.env as Bindings;
      return ctx.json({
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      });
    });

    /**
     * Dashboard-only CORS: browser origins must be explicitly allowed via
     * CLIENT_URL or the CORS_ALLOWED_ORIGINS binding. Requests without an
     * Origin header (curl, server-to-server) are unaffected.
     */
    this.instance.use(
      "/api/v1/*",
      cors({
        origin: (origin, c) => {
          const env = c.env as Bindings;
          const allowed = [
            env.CLIENT_URL,
            ...(env.CORS_ALLOWED_ORIGINS ?? "")
              .split(",")
              .map((entry) => entry.trim())
              .filter(Boolean),
          ].filter(Boolean);

          if (!origin) {
            return "*";
          }
          if (allowed.includes(origin)) {
            return origin;
          }
          return null;
        },
        allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
        maxAge: 86400,
      }),
    );
    this.instance.route("/api/v1", Router);

    this.instance.get("/api/v1/docs", swaggerUI({ url: "/doc" }));
    this.instance.doc("/doc", {
      info: {
        title: "Prism API",
        version: "v1",
      },
      openapi: "3.1.0",
    });
  }

  public getInstance() {
    return this.instance;
  }
}

export default new Server();
