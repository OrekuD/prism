import { v4 } from "uuid";
import { HonoConfig } from "../types/types";
import { Context } from "hono";

class WebSocketManager {
  private clients: Map<string, WebSocket>;

  constructor() {
    this.clients = new Map();
  }

  onConnect(ctx: Context<HonoConfig>): Response {
    const upgradeHeader = ctx.req.raw.headers.get("Upgrade");
    if (upgradeHeader !== "websocket") {
      return new Response("Expected Upgrade: websocket", { status: 426 });
    }

    const { 0: client, 1: server } = new WebSocketPair();

    server.accept();

    server.addEventListener("message", async (event) => {
      if (!event.data || typeof event.data !== "string") return;

      console.log(event.data);
      this.clients.set(event.data, server);
      server.send("Your project is connected");
    });

    server.addEventListener("close", () => {
      // this.clients.delete(clientId);
    });

    return new Response(null, {
      status: 101,
      webSocket: client,
    });
  }

  broadcast(message: string) {
    this.clients.forEach((client) => {
      client.send(message);
    });
  }

  emitToClient(clientId: string, message: string) {
    const client = this.clients.get(clientId);
    console.log({ client });
    if (!client) return false;
    client.send(message);
    return true;
  }

  getConnectedClientIds() {
    return Array.from(this.clients.keys());
  }
}

export default new WebSocketManager();
