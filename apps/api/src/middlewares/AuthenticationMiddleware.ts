import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { getAuth } from "../auth/auth";
import type { HonoConfig } from "../types/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { ensurePersonalWorkspace } from "../auth/provision";
import { createProductDb } from "../database/db";

/**
 * Session-to-Prism-user adapter.
 *
 * Better Auth establishes identity (cookie session); this middleware attaches
 * the typed Prism user to the Hono context. Workspace authorization state
 * (membership, roles, invitations, active workspace) is owned entirely by
 * Better Auth's Organization plugin (Task 13) — Prism controllers derive
 * every authorization decision from the canonical organization/member
 * tables and never trust a client-supplied identity or organization ID.
 *
 * It also provisions the personal owner workspace through Better Auth's
 * server API on the first authenticated request for users who signed up
 * before Task 13 or through paths without workspace provisioning.
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

      // Personal-workspace provisioning is best-effort and idempotent:
      // failures must not break the request (the next request retries).
      try {
        await ensurePersonalWorkspace(
          createProductDb(
            ctx.env as unknown as Record<string, string | undefined>,
          ).drizzle as never,
          auth as never,
          session.user as never,
        );
      } catch {
        // Provisioning retries on the next request; the session itself is
        // valid regardless.
      }
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
