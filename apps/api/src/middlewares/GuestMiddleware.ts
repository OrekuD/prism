import { DatabaseTables } from "../types/types";
import { createMiddleware } from "hono/factory";
import { HonoConfig } from "../types/types";
import { Context } from "hono";
import jwt from "@tsndr/cloudflare-worker-jwt";
import DatabaseManager from "../managers/DatabaseManager";
import User from "../models/User";
import { JWTPayload, Roles } from "@prism/types";

const GuestMiddleware = createMiddleware(
  async (ctx: Context<HonoConfig>, next) => {
    try {
      const authHeaderValue = ctx.req.header("Authorization");

      if (!authHeaderValue) {
        return await next();
      }

      const split = authHeaderValue.split("Bearer ");

      if (split.length !== 2) {
        return await next();
      }

      const isValid = await jwt.verify(split[1], ctx.env.JWT_SECRET_KEY);

      if (!isValid) {
        return await next();
      }

      const accessToken = jwt.decode(split[1]) as { payload: JWTPayload };

      if (!accessToken.payload.token) {
        return await next();
      }

      const oauthAccessToken = await DatabaseManager.getInstance(
        ctx,
      )`SELECT * FROM oauth_access_tokens WHERE access_token = ${accessToken.payload.token} AND is_revoked = false AND expiry_at > NOW()`;

      if (oauthAccessToken.length === 0) {
        return await next();
      }

      const user = (await DatabaseManager.getInstance(ctx)`
			SELECT
			  users.id as id,
				users.email as email,
				users.user_name as user_name,
				users.role as role,
				json_build_object(
					'first_name', profiles.first_name,
					'last_name', profiles.last_name,
					'gender', profiles.gender,
					'email_verified_at', profiles.email_verified_at
				) AS profile
			FROM
				users
			JOIN
				profiles ON users.id = profiles.user_id
			WHERE users.id = ${oauthAccessToken[0].user_id} AND users.role = ${Roles.USER};
			`) as Array<User>;

      if (user.length === 0) {
        return await next();
      }

      ctx.set("user", user[0]);
      ctx.set("oauthAccessTokenId", oauthAccessToken[0].id);
    } catch (error) {
      return await next();
    }
    return await next();
  },
);

export default GuestMiddleware;
