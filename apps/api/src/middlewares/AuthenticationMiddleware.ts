import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { getAuth } from "../auth/auth";
import type { HonoConfig } from "../types/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";

/**
 * Session-to-Prism-user adapter.
 *
 * Better Auth establishes identity (cookie session); this middleware attaches
 * the typed Prism user to the Hono context. All authorization (teams,
 * projects, invites, API keys) stays in Prism controllers — never trust a
 * client-supplied identity.
 */
export const AuthenticationMiddleware = createMiddleware(
  async (ctx: Context<HonoConfig>, next) => {
    try {
      const auth = getAuth(ctx.env);
      const session = await auth.api.getSession({
        headers: ctx.req.raw.headers,
      });

      if (!session) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      ctx.set("user", session.user as never);
    } catch {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  },
);

/**
 * Guards sensitive product actions behind a verified email address.
 * Unverified users can still browse and manage basic account settings, but
 * cannot create teams, projects, or invite members.
 */
export const RequireVerifiedEmailMiddleware = createMiddleware(
  async (ctx: Context<HonoConfig>, next) => {
    const user = ctx.get("user") as { emailVerified?: boolean } | undefined;

    if (!user?.emailVerified) {
      return ctx.json(
        new ErrorResponse("email_not_verified").toJSON(),
        403,
      );
    }

    await next();
  },
);
