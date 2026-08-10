import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import dotenv from "dotenv";
import { cors } from "hono/cors";
import WebSocketManager from "./managers/WebSocketManager.js";
import Router from "./routers/Router.js";

dotenv.config();

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("/*", cors());

app.get("/", (ctx) => {
  return ctx.text("Waguan!");
});

app.get(
  "/ws",
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

app.route("api/v1", Router);

app.get("/test", async (ctx) => {
  const test = { message: "ok" };
  return ctx.text("Hello Test!");
});

const port = process.env.PORT ? Number.parseInt(process.env.PORT) : 8080;

const REQUIRED_ENV_VARS = [
  "JWT_SECRET_KEY",
  "TURSO_DATABASE_URL",
  "TURSO_AUTH_TOKEN",
  "NEONDB_PGHOST",
  "NEONDB_PGDATABASE",
  "NEONDB_PGUSER",
  "NEONDB_PGPASSWORD",
  "NEONDB_ENDPOINT_ID",
] as const;

function validateEnvironment() {
  const missing = REQUIRED_ENV_VARS.filter((key) => !process.env[key]);

  if (missing.length === 0) {
    return;
  }

  console.error(
    [
      "[prism-analytics-api] Missing required environment variables:",
      ...missing.map((key) => `  - ${key}`),
      "",
      "Copy apps/analytics-api/.env.example to apps/analytics-api/.env and fill in the values.",
    ].join("\n"),
  );
  process.exit(1);
}

validateEnvironment();

console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

injectWebSocket(server);
