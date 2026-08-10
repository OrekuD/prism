import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";
import { JwtVerifier } from "../services/JwtVerifier.js";
import { config } from "dotenv";

config();

/**
 * Service-JWT authentication for the analytics API.
 *
 * Verifies a short-lived JWT issued by the main API's Better Auth JWT plugin
 * against its JWKS, then confirms the subject is an active user.
 */
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

      const authBaseUrl = process.env.AUTH_BASE_URL;
      if (!authBaseUrl) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const verified = await JwtVerifier.verify(
        split[1],
        `${authBaseUrl.replace(/\/$/, "")}/api/auth/jwks`,
      );

      if (!verified?.sub) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const user =
        await NeonDatabaseManager.instance`SELECT id FROM "user" WHERE id = ${verified.sub}`;

      if (user.length === 0) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      ctx.set("userId", user[0].id);
    } catch (error) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  },
);
