import {
  StartSessionRequestSchema,
  type StartSessionRequest,
  type EndSessionRequest,
  EndSessionRequestSchema,
  type LogEventRequest,
  LogEventRequestSchema,
  type SessionResource,
  type SocketUserConnected,
} from "@prism/types";
import type { Context } from "hono";
import { OkResponse } from "../network/responses/OkResponse.js";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import { validateData } from "../utils/validateData.js";
import { getBrowser } from "../utils/getBrowser.js";
import { isMobile } from "../utils/isMobile.js";
import { getOS } from "../utils/getOS.js";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import WebSocketManager from "../managers/WebSocketManager.js";
import { CreateNewSessionResponse } from "../network/responses/CreateNewSessionResponse.js";
import { IpEnrichmentService } from "../services/IpEnrichmentService.js";
import { v4 } from "uuid";
import { config } from "dotenv";

config();

export class AnalyticsController {
  public static async startSession(ctx: Context) {
    const body = await ctx.req.json<StartSessionRequest>();

    const data = validateData(StartSessionRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    // Client IP is used only for best-effort geo enrichment and is never
    // trusted for authorization. Local development falls back to a clearly
    // local address instead of a hardcoded public one.
    const clientIp =
      ctx.req.header("cf-connecting-ip") ||
      ctx.req.raw.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "127.0.0.1";

    // Optional, non-blocking: on any failure the session is still recorded
    // with null geo fields.
    const enrichment = await IpEnrichmentService.enrich(clientIp);

    const projectId = ctx.get("projectId") ?? "";
    const os = getOS(data.userAgent);
    const browser = getBrowser(data.userAgent);
    const mobile = isMobile(data.userAgent);

    const results = await TursoDatabaseManager.instance.execute({
      sql: "INSERT INTO sessions (project_id, session_id, referrer, country_code, os, browser, location, is_mobile, ip, lat, long, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
      args: [
        projectId,
        v4(),
        data.referrer,
        enrichment.country_code,
        os,
        browser,
        data.location,
        mobile ? 1 : 0,
        clientIp,
        enrichment.lat,
        enrichment.long,
        1,
      ],
    });

    let sessionId = "";

    if (results.rows.length !== 0) {
      sessionId = results.rows[0].session_id as string;
      const message: SocketUserConnected = {
        type: "user-connected",
        data: {
          session: results.rows[0] as unknown as SessionResource,
        },
      };
      WebSocketManager.emitToClient(projectId, JSON.stringify(message));
    }

    return ctx.json(new CreateNewSessionResponse(sessionId).toJSON());
  }

  public static async endSession(ctx: Context) {
    const body = await ctx.req.json<EndSessionRequest>();

    const data = validateData(EndSessionRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    // The project id is derived from the authenticated analytics API key, so
    // a key from one project can never end a session belonging to another.
    const projectId = ctx.get("projectId");

    if (!projectId) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    await TursoDatabaseManager.instance.execute({
      sql: "UPDATE sessions SET is_online = 0 WHERE session_id = ? AND project_id = ?",
      args: [data.sessionId, projectId],
    });

    return ctx.json(new OkResponse().toJSON());
  }

  /**
   * Ingests a named event for the authenticated project's session.
   * The event is stored in Turso and shown on the project events dashboard.
   */
  public static async logEvent(ctx: Context) {
    const body = await ctx.req.json<LogEventRequest>();

    const data = validateData(LogEventRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const projectId = ctx.get("projectId") ?? "";

    await TursoDatabaseManager.instance.execute({
      sql: "INSERT INTO events (session_id, project_id, name, data) VALUES (?, ?, ?, ?)",
      args: [
        data.sessionId,
        projectId,
        data.name,
        data.data === undefined ? null : JSON.stringify(data.data),
      ],
    });

    return ctx.json(new OkResponse().toJSON());
  }
}
