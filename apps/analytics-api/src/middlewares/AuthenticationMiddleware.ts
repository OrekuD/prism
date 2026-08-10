import { type JWTPayload, Roles } from "@prism/types";
import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import jwt from "jsonwebtoken";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";
import { config } from "dotenv";

config();

export const AuthenticationMiddleware = createMiddleware(
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

      const isValid = jwt.verify(split[1], process.env.JWT_SECRET_KEY ?? "");

      if (!isValid) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const accessToken = jwt.decode(split[1]) as JWTPayload | null;

      if (!accessToken?.token) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const oauthAccessToken =
        await NeonDatabaseManager.instance`SELECT id, user_id FROM oauth_access_tokens WHERE access_token = ${accessToken.token} AND is_revoked = false AND expiry_at > NOW()`;

      if (oauthAccessToken.length === 0) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const user =
        await NeonDatabaseManager.instance`SELECT id FROM users WHERE users.id = ${oauthAccessToken[0].user_id} AND users.role = ${Roles.USER};`;

      if (user.length === 0) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }
    } catch (error) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  },
);
