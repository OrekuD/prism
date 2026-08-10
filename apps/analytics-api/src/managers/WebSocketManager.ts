import type { WSContext } from "hono/ws";
import {
  type JWTPayload,
  Roles,
  type SocketConnectProject,
  type SocketMessageTypes,
} from "@prism/types";
import jwt from "jsonwebtoken";
import NeonDatabaseManager from "./NeonDatabaseManager.js";
import { config } from "dotenv";

config();

class WebSocketManager {
  private clients: Map<string, Array<WSContext>>;
  private socketProject: WeakMap<WSContext, string>;

  constructor() {
    this.clients = new Map();
    this.socketProject = new WeakMap();
  }

  onConnect(event: Event, ws: WSContext) {
    // Connection lifecycle is handled in onMessage: a socket only becomes a
    // subscriber after presenting a valid signed access token.
    return;
  }

  async onMessage(event: Event, ws: WSContext) {
    let message: SocketMessageTypes;
    try {
      message = JSON.parse((event as unknown as { data: string }).data);
    } catch {
      // Malformed payload: close instead of crashing the server.
      ws.close();
      return;
    }

    switch (message.type) {
      case "connect-project": {
        const userId = await this.authenticate(message.data);
        if (!userId) {
          ws.close();
          return;
        }

        const projectId = message.data.projectId;
        const existing = this.clients.get(projectId);
        if (!existing) {
          this.clients.set(projectId, [ws]);
        } else {
          this.clients.set(projectId, [...existing, ws]);
        }
        this.socketProject.set(ws, projectId);
        break;
      }
    }
  }

  /**
   * Removes a closed socket from the in-memory client map. Called from the
   * WebSocket server's onClose handler.
   */
  onClose(ws: WSContext) {
    const projectId = this.socketProject.get(ws);
    if (!projectId) return;

    this.socketProject.delete(ws);

    const sockets = this.clients.get(projectId);
    if (!sockets) return;

    const remaining = sockets.filter((socket) => socket !== ws);
    if (remaining.length === 0) {
      this.clients.delete(projectId);
    } else {
      this.clients.set(projectId, remaining);
    }
  }

  broadcast(message: string) {
    for (const client of this.clients.values()) {
      for (const ws of client) {
        ws.send(message);
      }
    }
  }

  emitToClient(clientId: string, message: string) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    for (const ws of client) {
      ws.send(message);
    }
    return true;
  }

  getConnectedClientIds() {
    return Array.from(this.clients.keys());
  }

  /**
   * Authenticates a `connect-project` request.
   *
   * Identity is derived exclusively from the signed access-token JWT: the
   * JWT must verify against the shared secret, its opaque token must have a
   * live, non-revoked row in `oauth_access_tokens`, the owning user must be
   * an active USER, and that user must own or belong to the team that owns
   * the requested project. Client-supplied user IDs are never trusted.
   *
   * @returns the authenticated userId, or null when the request is invalid.
   */
  private async authenticate(
    payload: SocketConnectProject["data"],
  ): Promise<string | null> {
    if (
      !payload ||
      typeof payload.projectId !== "string" ||
      typeof payload.token !== "string" ||
      payload.token.length === 0
    ) {
      return null;
    }

    let decoded: JWTPayload | null = null;
    try {
      const isValid = jwt.verify(payload.token, process.env.JWT_SECRET_KEY ?? "");
      if (!isValid) return null;
      // jsonwebtoken.decode returns the payload object directly.
      const parsed = jwt.decode(payload.token) as JWTPayload | null;
      decoded = parsed;
    } catch {
      return null;
    }

    if (!decoded?.token || !decoded?.userId) {
      return null;
    }

    // The backing OAuth access-token record must exist, not be revoked, and
    // not be expired.
    const oauthAccessToken =
      await NeonDatabaseManager.instance`SELECT user_id FROM oauth_access_tokens WHERE access_token = ${decoded.token} AND is_revoked = false AND expiry_at > NOW()`;

    if (oauthAccessToken.length === 0) {
      return null;
    }

    const user =
      await NeonDatabaseManager.instance`SELECT id FROM users WHERE users.id = ${oauthAccessToken[0].user_id} AND users.role = ${Roles.USER};`;

    if (user.length === 0) {
      return null;
    }

    const project =
      await NeonDatabaseManager.instance`SELECT id, team_id FROM projects WHERE id = ${payload.projectId};`;

    if (project.length === 0) {
      return null;
    }

    const team =
      await NeonDatabaseManager.instance`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`;

    if (team.length === 0) {
      return null;
    }

    if (user[0].id === team[0].owner_id) {
      return user[0].id;
    }

    const teamMember =
      await NeonDatabaseManager.instance`SELECT id FROM team_members WHERE user_id = ${user[0].id} AND team_id = ${team[0].id}`;

    if (teamMember.length === 0) {
      return null;
    }

    return user[0].id;
  }

  /** Test helper: clears all registered clients. */
  resetForTests() {
    this.clients.clear();
    this.socketProject = new WeakMap();
  }
}

export default new WebSocketManager();
