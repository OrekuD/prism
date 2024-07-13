import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import WebSocketManager from "./managers/WebSocketManager";
import NeonDatabaseManager from "./managers/NeonDatabaseManager";
import dotenv from "dotenv";
import { cors } from "hono/cors";
import Router from "./routers/Router";

dotenv.config();

const app = new Hono();

const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

app.use("*", cors());

app.get("/", (ctx) => {
  return ctx.text("Hello Hono!");
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
  console.log({ e: ctx.env });
  const test = { message: "ok" };

  // const oauthAccessToken =
  //   await NeonDatabaseManager.instance`SELECT * FROM oauth_access_tokens WHERE is_revoked = false AND expiry_at > NOW()`;

  // console.log({ oauthAccessToken });

  // await DatabaseManager.instance.execute("SELECT * FROM users");

  // WebSocketManager.emitToClient(
  //   "6cc1e9f6-975f-439f-9fa9-e756e59ece5a",
  //   JSON.stringify(test),
  // );
  return ctx.text("Hello Test!");
});

const port = process.env.PORT ? parseInt(process.env.PORT) : 8080;
console.log(`Server is running on port ${port}`);

const server = serve({
  fetch: app.fetch,
  port,
});

injectWebSocket(server);
