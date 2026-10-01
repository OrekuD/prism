import { createNodeWebSocket } from "@hono/node-ws";
import WebSocketManager from "./managers/WebSocketManager.js";
import { createHttpApp, ingestionLimiter, rateLimitMiddleware, websocketLimiter } from "./httpApp.js";

export { ingestionLimiter };

export const app = createHttpApp((_ctx, projectId, message) => {
  WebSocketManager.emitToClient(projectId, message);
});

export const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

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
    onClose(_event, ws) {
      return WebSocketManager.onClose(ws);
    },
  })),
);
