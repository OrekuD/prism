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
  })) as any, // temp fix
);

app.route("api/v1", Router);

app.get("/test", async (ctx) => {
  const test = { message: "ok" };
  return ctx.text("Hello Test!");
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

injectWebSocket(server);
