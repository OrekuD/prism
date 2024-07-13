import {
  AddNewSessionDataRequest,
  AddNewSessionDataRequestSchema,
  IpInfoResponse,
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

export class AnalyticsController {
  public static async createNewSession(ctx: Context) {
    const body = await ctx.req.json<AddNewSessionDataRequest>();

    const data = validateData(AddNewSessionDataRequestSchema, body);

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

    const ipDetailsData = (await ipDetailsResponse.json()) as IpInfoResponse;
    console.log({ ipDetailsData });

    const coords = ipDetailsData.loc.split(",");

    const projectId = ctx.get("projectId")!;
    const os = getOS(data.userAgent);
    const browser = getBrowser(data.userAgent);
    const mobile = isMobile(data.userAgent);

    const results = await TursoDatabaseManager.instance.execute({
      sql: "INSERT INTO sessions (project_id, referrer, country_code, os, browser, location, is_mobile, ip, lat, long, is_online) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING *",
      args: [
        projectId,
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

    console.log({ results: results.rows });

    if (results.rows.length !== 0) {
      console.log("sending...");
      WebSocketManager.emitToClient(projectId, JSON.stringify(results.rows[0]));
    }

    return ctx.json(new OkResponse().toJSON());
  }
}
