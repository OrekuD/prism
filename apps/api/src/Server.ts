import { cors } from "hono/cors";
import { router as Router } from "./routers/Router";
import type { Bindings, HonoConfig } from "./types/types";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";

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
