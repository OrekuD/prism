import { cors } from "hono/cors";
import { createMiddleware } from "hono/factory";
import { router as Router } from "./routers/Router";
import type { Bindings, HonoConfig } from "./types/types";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";
import { getAuth } from "./auth/auth";
import { isOriginAllowed } from "./utils/cors";
import { DatabaseManager } from "./managers/DatabaseManager";
import { StorageManager } from "./managers/StorageManager";
import { setEmailExecutor } from "./auth/mail";
import { ErrorResponse } from "./network/responses/ErrorResponse";
import { RateLimiter, clientIpFrom } from "./utils/RateLimiter";

// Soft per-IP throttle for Better Auth mutating endpoints (signup, sign-in, OTP,
// reset, social callbacks). Read-only session checks (get-session, providers,
// token) are exempt — the web dashboard polls get-session on every
// navigation and after sign-in (waitForSession), and a tight limit there
// causes a 429 storm that locks the UI after login. In-memory, per isolate
// — production enforcement needs a shared store (see README security model).
export const authRateLimiter = new RateLimiter(60_000, 60);

const AUTH_RATE_LIMIT_EXEMPT = new Set([
  "/api/auth/get-session",
  "/api/auth/providers",
  "/api/auth/token",
]);

const authRateLimit = createMiddleware(async (ctx, next) => {
  const path = ctx.req.path;
  // Exempt high-frequency read-only checks; only limit mutating auth.
  if (ctx.req.method === "GET" && AUTH_RATE_LIMIT_EXEMPT.has(path)) {
    await next();
    return;
  }
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
     * Health checks (task-6 section 2): /health/live is process health,
     * /health/ready verifies the product database. No configuration is
     * leaked in the responses.
     */
    this.instance.get("/health/live", (ctx) => {
      return ctx.json({ status: "ok" });
    });

    this.instance.get("/health/ready", async (ctx) => {
      try {
        const db = DatabaseManager.getInstance(ctx);
        await db`SELECT 1`;
        return ctx.json({ status: "ready" });
      } catch {
        return ctx.json({ status: "not_ready" }, 503);
      }
    });

    /**
     * Local storage driver: serve uploaded files (avatars) from disk.
     * Registered on every runtime; only active when STORAGE_DRIVER=local
     * (path traversal is blocked regardless).
     */
    this.instance.get("/files/*", async (ctx) => {
      const key = ctx.req.path.replace(/^\/files\//, "");
      if (!key || key.includes("\\")) {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
      const full = await StorageManager.localFilePath(ctx, key);
      if (!full) {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
      const { readFile } = await import("node:fs/promises");
      const { extname } = await import("node:path");
      const contentTypes: Record<string, string> = {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".svg": "image/svg+xml",
        ".avif": "image/avif",
      };
      try {
        const data = await readFile(full);
        return new Response(data, {
          headers: {
            "content-type": contentTypes[extname(key).toLowerCase()] ?? "application/octet-stream",
            "cache-control": "public, max-age=31536000, immutable",
          },
        });
      } catch {
        return ctx.json({ errors: ["not_found"] }, 404);
      }
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
          if (!origin) {
            return "*";
          }
          if (isOriginAllowed(origin, c.env as Bindings)) {
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

    // Public provider inventory so the UI can hide unavailable buttons.
    // MUST be registered before the catch-all below: Hono matches in
    // registration order, and better-auth would otherwise 404 it.
    this.instance.get("/api/auth/providers", (ctx) => {
      const env = ctx.env as Bindings;
      return ctx.json({
        github: Boolean(env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET),
        google: Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET),
      });
    });

    this.instance.all("/api/auth/*", (ctx) => {
      // Keep scheduled emails (verification/reset) alive beyond the response.
      setEmailExecutor((promise) => ctx.executionCtx.waitUntil(promise));
      const auth = getAuth(ctx.env);
      return auth.handler(ctx.req.raw);
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
        credentials: true,
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
