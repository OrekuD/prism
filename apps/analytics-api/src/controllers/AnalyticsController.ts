import {
  StartSessionRequestSchema,
  StartSessionRequest,
  EndSessionRequest,
  EndSessionRequestSchema,
  IpInfoResponse,
  SocketUserConnected,
} from "@prism/types";
import { Context } from "hono";
import { OkResponse } from "../network/responses/OkResponse";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { validateData } from "../utils/validateData";
import { getBrowser } from "../utils/getBrowser";
import { isMobile } from "../utils/isMobile";
import { getOS } from "../utils/getOS";
import TursoDatabaseManager from "../managers/TursoDatabaseManager";
import WebSocketManager from "../managers/WebSocketManager";
import { CreateNewSessionResponse } from "../network/responses/CreateNewSessionResponse";
import { v4 } from "uuid";

export class AnalyticsController {
  public static async startSession(ctx: Context) {
    const body = await ctx.req.json<StartSessionRequest>();

    const data = validateData(StartSessionRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const clientIp =
      ctx.req.header("cf-connecting-ip") ||
      ctx.req.raw.headers.get("x-forwarded-for") ||
      "154.161.151.38"; // for testing in development

    const ipDetailsResponse = await fetch(
      `https://ipinfo.io/${clientIp}/json?token=${process.env.IP_INFO_API_TOKEN}`,
    );

    // const ipDetailsResponse = await fetch(`https://ipapi.co/${clientIp}/json`);

    const ipDetailsData = (await ipDetailsResponse.json()) as IpInfoResponse;
    // const ipDetailsData = (await ipDetailsResponse.json()) as IpAPIResponse;

    console.log({ ipDetailsData });

    const coords = ipDetailsData.loc.split(",");
    // const coords = [ipDetailsData.latitude, ipDetailsData.longitude];

    const projectId = ctx.get("projectId")!;
    const os = getOS(data.userAgent);
    const browser = getBrowser(data.userAgent);
    const mobile = isMobile(data.userAgent);

    const results = await TursoDatabaseManager.instance.execute({
      sql: "INSERT INTO sessions (project_id, session_id, referrer, country_code, os, browser, location, is_mobile, ip, lat, long, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
      args: [
        projectId,
        v4(),
        data.referrer,
        ipDetailsData.country,
        os,
        browser,
        data.location,
        mobile ? 1 : 0,
        clientIp,
        coords[0],
        coords[1],
        1,
      ],
    });

    let sessionId = "";

    if (results.rows.length !== 0) {
      sessionId = results.rows[0].session_id! as string;
      const message: SocketUserConnected = {
        type: "user-connected",
        data: {
          session: results.rows[0] as any,
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

    await TursoDatabaseManager.instance.execute({
      sql: "UPDATE sessions SET is_online = 0 WHERE session_id = ?",
      args: [data.sessionId],
    });

    console.log("done");

    return ctx.json(new OkResponse().toJSON());
  }
}
