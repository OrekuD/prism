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

      // If the session has no active organization, default it to the user's
      // first workspace. Otherwise the Organization plugin's
      // get-active-member endpoint 400s (NO_ACTIVE_ORGANIZATION), which the
      // dashboard retries on members/sources pages and can trip the auth
      // rate limiter (burst of failing calls -> 429s on get-session). This
      // also auto-selects the first workspace for new/returning sign-ins.
      // Best-effort and idempotent: once the session is updated, later
      // requests read the persisted activeOrganizationId and skip this.
      const hasActiveOrganization = Boolean(
        (session.session as { activeOrganizationId?: string })
          .activeOrganizationId,
      );
      if (!hasActiveOrganization) {
        try {
          // The server API is typed through InferAPI from the base plugin;
          // the organization plugin's methods aren't in that type, so cast
          // narrowly to just the two calls we need.
          const orgApi = (
            auth.api as unknown as {
              organization: {
                listOrganizations: (args: {
                  headers: Headers;
                }) => Promise<Array<{ id: string }>>;
                setActive: (args: {
                  body: { organizationId: string };
                  headers: Headers;
                }) => Promise<unknown>;
              };
            }
          ).organization;
          const organizations = await orgApi.listOrganizations({
            headers: ctx.req.raw.headers,
          });
          const firstOrganizationId = organizations[0]?.id;
          if (firstOrganizationId) {
            await orgApi.setActive({
              body: { organizationId: firstOrganizationId },
              headers: ctx.req.raw.headers,
            });
          }
        } catch {
          // Best-effort; get-active-member degrades gracefully.
        }
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
