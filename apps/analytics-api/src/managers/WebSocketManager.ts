import { WSContext } from "hono/ws";
import {
  JWTPayload,
  Roles,
  SocketConnectProject,
  SocketMessageTypes,
} from "@prism/types";
import jwt from "jsonwebtoken";
import NeonDatabaseManager from "./NeonDatabaseManager.js";
import { config } from "dotenv";

config();

class WebSocketManager {
  private clients: Map<string, Array<WSContext>>;

  constructor() {
    this.clients = new Map();
  }

  onConnect(event: Event, ws: WSContext) {
    // if (this.clients.has(event))
    // console.log({ event: event.da });
  }

  async onMessage(event: Event, ws: WSContext) {
    const message: SocketMessageTypes = JSON.parse((event as any).data);

    switch (message.type) {
      case "connect-project":
        const isValid = await this.verifyUser(message.data);
        if (!isValid) return;
        if (!this.clients.has(message.data.projectId)) {
          this.clients.set(message.data.projectId, [ws]);
        } else {
          const oldValues = this.clients.get(message.data.projectId)!;
          this.clients.set(message.data.projectId, [...oldValues, ws]);
        }
        break;
    }
  }

  broadcast(message: string) {
    this.clients.forEach((client) => {
      client.forEach((ws) => {
        ws.send(message);
      });
    });
  }

  emitToClient(clientId: string, message: string) {
    const client = this.clients.get(clientId);
    if (!client) return false;
    client.forEach((ws) => ws.send(message));
    return true;
  }

  getConnectedClientIds() {
    return Array.from(this.clients.keys());
  }

  async verifyUser(payload: SocketConnectProject["data"]) {
    console.log({
      key: process.env.JWT_SECRET_KEY!,
      token: payload.accessToken,
    });
    const decoded = jwt.verify(
      payload.accessToken,
      process.env.JWT_SECRET_KEY!,
    ) as JWTPayload;

    console.log({ decoded });

    const oauthAccessToken =
      await NeonDatabaseManager.instance`SELECT id, user_id FROM oauth_access_tokens WHERE access_token = ${decoded.token} AND is_revoked = false AND expiry_at > NOW()`;

    if (oauthAccessToken.length === 0) {
      return false;
    }

    const user =
      await NeonDatabaseManager.instance`SELECT id FROM users WHERE users.id = ${oauthAccessToken[0].user_id} AND users.role = ${Roles.USER};`;

    if (user.length === 0) {
      return false;
    }

    const project =
      await NeonDatabaseManager.instance`SELECT id, team_id FROM projects WHERE id = ${payload.projectId};`;

    if (project.length === 0) {
      return false;
    }

    const team =
      await NeonDatabaseManager.instance`SELECT id, owner_id FROM teams WHERE id = ${project[0].team_id}`;

    if (team.length === 0) {
      return false;
    }

    if (user[0].id === team[0].owner_id) {
      return true;
    }

    const teamMember =
      await NeonDatabaseManager.instance`SELECT id FROM team_members WHERE user_id = ${user[0].id} AND team_id = ${team[0].id}`;

    if (teamMember.length === 0) {
      return false;
    }

    return true;

    // const result = await NeonDatabaseManager.instance`
    //     WITH oauth_check AS (
    //       SELECT user_id
    //       FROM oauth_access_tokens
    //       WHERE access_token = ${decoded.token}
    //         AND is_revoked = false
    //         AND expiry_at > NOW()
    //     ),
    //     user_check AS (
    //       SELECT u.id AS user_id
    //       FROM users u
    //       JOIN oauth_check o ON u.id = o.user_id
    //       WHERE u.role = ${Roles.USER}
    //     ),
    //     project_check AS (
    //       SELECT p.team_id
    //       FROM projects p
    //       WHERE p.id = ${payload.projectId}
    //     ),
    //     team_check AS (
    //       SELECT t.id AS team_id, t.owner_id
    //       FROM teams t
    //       JOIN project_check p ON t.id = p.team_id
    //     ),
    //     access_check AS (
    //       SELECT
    //         CASE
    //           WHEN u.user_id = t.owner_id THEN true
    //           WHEN EXISTS (
    //             SELECT 1
    //             FROM team_members tm
    //             WHERE tm.user_id = u.user_id AND tm.team_id = t.team_id
    //           ) THEN true
    //           ELSE false
    //         END AS has_access
    //       FROM user_check u
    //       CROSS JOIN team_check t
    //     )
    //     SELECT has_access
    //     FROM access_check;
    //   `;

    // return result.length > 0 ? result[0].has_access : false;
  }
}

export default new WebSocketManager();
