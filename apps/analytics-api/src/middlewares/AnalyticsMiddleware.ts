import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";

export const AnalyticsMiddleware = createMiddleware(
  async (ctx: Context, next) => {
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

      const key =
        await NeonDatabaseManager.instance`SELECT project_id FROM project_api_keys WHERE key = ${apiKey}`;

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
