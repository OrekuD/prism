import { JWTPayload, Roles } from "@prism/types";
import { createMiddleware } from "hono/factory";
import { HonoConfig } from "../types/types";
import { Context } from "hono";
import { DatabaseManager } from "../managers/DatabaseManager";
import { User } from "../models/User";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { ProjectApiKey } from "../models/ProjectApiKey";

export const AnalyticsMiddleware = createMiddleware(
  async (ctx: Context<HonoConfig>, next) => {
    try {
      const authHeaderValue = ctx.req.header("Authorization");

      if (!authHeaderValue) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const split = authHeaderValue.split("Bearer ");

      if (split.length !== 2) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const apiKey = split[1] || "";

      if (!apiKey) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const key = (await DatabaseManager.getInstance(
        ctx,
      )`SELECT project_id FROM project_api_keys WHERE key = ${apiKey}`) as Array<ProjectApiKey>;

      if (key.length === 0) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      ctx.set("projectId", key[0].project_id);
    } catch (error) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  },
);
