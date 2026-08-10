import { cors } from "hono/cors";
import { router as Router } from "./routers/Router";
import type { HonoConfig } from "./types/types";
import { swaggerUI } from "@hono/swagger-ui";
import { OpenAPIHono } from "@hono/zod-openapi";

class Server {
  private instance: OpenAPIHono<HonoConfig>;

  constructor() {
    // this.instance = new Hono();
    this.instance = new OpenAPIHono();
  }

  public startServer() {
    this.instance.get("/", async (ctx) => {
      return ctx.text("Waguan");
    });

    this.instance.use("/api/v1/*", cors());
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
