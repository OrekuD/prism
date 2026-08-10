import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/neon-http";
import { sql } from "drizzle-orm";
import { neon } from "@neondatabase/serverless";
import type { Context } from "hono";
import { buildAuthOptions } from "../auth/options";
import { provisionUserResources } from "../auth/provision";
import { resolvePrismConfig } from "../config";
import { DatabaseManager } from "../managers/DatabaseManager";
import type { Bindings, HonoConfig } from "../types/types";
import * as authSchema from "../database/schema/auth";
import { Roles } from "@prism/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";

/**
 * One-time first-owner setup (task-6 section 4, task-5 12.2).
 *
 * Self-hosted mode only, and only while the database has zero users: the
 * path closes permanently after the first owner exists (404 afterwards),
 * so it cannot be replayed. Registration policy is bypassed for this one
 * request by building an auth instance with signup enabled; everything
 * after the owner exists goes through the configured policy.
 */
export class SetupController {
  public static async createOwner(ctx: Context<HonoConfig>) {
    const env = ctx.env as Bindings;

    const config = resolvePrismConfig(
      env as unknown as Record<string, string | undefined>,
    );
    if (config.deploymentMode !== "self-hosted") {
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }

    let userCount: number;
    try {
      const db = DatabaseManager.getInstance(ctx);
      const rows = await db`SELECT id FROM "user" LIMIT 1`;
      userCount = rows.length;
    } catch {
      return ctx.json(
        new ErrorResponse("database_not_ready").toJSON(),
        503,
      );
    }

    if (userCount > 0) {
      // Bootstrap closed: hide the endpoint entirely.
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }

    let body: { name?: string; email?: string; password?: string };
    try {
      body = await ctx.req.json<{
        name?: string;
        email?: string;
        password?: string;
      }>();
    } catch {
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }

    const name = body.name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";

    if (!name || !email || !password) {
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }
    if (password.length < 8) {
      return ctx.json(new ErrorResponse("weak_password").toJSON(), 400);
    }

    // One-time auth instance with signup enabled for the bootstrap request.
    const client = neon(env.DATABASE_URL);
    const db = drizzle(client);
    const options = buildAuthOptions(
      env as unknown as Record<string, string | undefined>,
      db as never,
    );
    options.emailAndPassword = {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false,
    };
    const auth = betterAuth({
      ...options,
      database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    });

    const result = await auth.api.signUpEmail({
      body: { email, password, name },
    });

    if (!result || !result.user) {
      return ctx.json(
        new ErrorResponse("signup_failed").toJSON(),
        400,
      );
    }

    // Promote to ADMIN and provision profile + personal team (no cloud).
    const userId = (result.user as { id: string }).id;
    await db.execute(sql`UPDATE "user" SET role = ${Roles.ADMIN} WHERE id = ${userId}`);
    await provisionUserResources(db as never, {
      id: userId,
      name: result.user.name,
      email: result.user.email,
    });

    return ctx.json({ ok: true });
  }
}
