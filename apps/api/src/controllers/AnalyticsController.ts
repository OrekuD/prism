import { Context } from "hono";
import { DatabaseTables, HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { generateProjectSlug } from "../utils/generateProjectSlug";
import {
  AddNewSessionDataRequest,
  AddNewSessionDataRequestSchema,
} from "@prism/types";
import { validateData } from "../utils/validateData";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { OkResponse } from "../network/responses/OkResponse";
import { getOS } from "../utils/getOS";
import { getBrowser } from "../utils/getBrowser";
import { isMobile } from "../utils/isMobile";

export class AnalyticsController {
  public static async createNewSession(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<AddNewSessionDataRequest>();

    const data = validateData(AddNewSessionDataRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const projectId = ctx.get("projectId")!;
    const os = getOS(data.userAgent);
    const browser = getBrowser(data.userAgent);
    const mobile = isMobile(data.userAgent);

    await ctx.env.DB.prepare(
      "INSERT INTO sessions (project_id, referrer, country_code, os, browser, location, is_mobile) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
      .bind(
        projectId,
        data.referrer,
        data.countryCode,
        os,
        browser,
        data.location,
        mobile ? 0 : 1,
      )
      .all();

    return ctx.json(new OkResponse().toJSON());
  }
}
