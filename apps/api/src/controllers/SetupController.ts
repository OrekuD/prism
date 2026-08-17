import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import type { Context } from "hono";
import { buildAuthOptions } from "../auth/options";
import { createPersonalWorkspace, provisionUserResources } from "../auth/provision";
import { resolvePrismConfig } from "../config";
import { createProductDb } from "../database/db";
import { clientIpFrom, RateLimiter } from "../utils/RateLimiter";
import type { Bindings, HonoConfig } from "../types/types";
import * as authSchema from "../database/schema/auth";
import { Roles } from "@prism-analytics/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { logger } from "../utils/logger";

/** Stale-claim threshold: a claim older than this with zero users means
 * the previous setup request crashed before creating anything. */
const CLAIM_TTL_MS = 5 * 60 * 1000;

/**
 * One-time first-owner setup (task-6 section 4, task-5 12.2).
 *
 * Self-hosted mode only, and only while the database has zero users: the
 * path closes permanently after the first owner exists (404 afterwards),
 * so it cannot be replayed. Registration policy is bypassed for this one
 * request by building an auth instance with signup enabled; everything
 * after the owner exists goes through the configured policy.
 *
 * Security (fresh instances must not be claimable remotely):
 * - Every self-hosted instance must set SETUP_TOKEN (config validation
 *   fails fast otherwise); the endpoint demands it via the X-Setup-Token
 *   header and compares digests in constant time.
 * - Requests are rate limited per client IP.
 * - The claim is atomic: the single-row `setup_claim` table (migration
 *   0002) makes concurrent first-boot requests race on the INSERT, so
 *   only one can proceed. A claim older than the TTL with zero users is
 *   stale (the previous request crashed) and is recovered before retry.
 * - Any failure after user creation rolls the account back (sessions,
 *   accounts, verification, and the user row are removed), so a
 *   partially configured owner can never close setup permanently.
 */
export class SetupController {
  private static limiter = new RateLimiter(15 * 60 * 1000, 5);

  /** Test hook: clear the per-IP rate-limit budget between cases. */
  public static resetRateLimitForTests(): void {
    SetupController.limiter.reset();
  }

  private static async tokensEqual(
    provided: string,
    expected: string,
  ): Promise<boolean> {
    const encoder = new TextEncoder();
    const [providedDigest, expectedDigest] = await Promise.all([
      crypto.subtle.digest("SHA-256", encoder.encode(provided)),
      crypto.subtle.digest("SHA-256", encoder.encode(expected)),
    ]);
    const a = new Uint8Array(providedDigest);
    const b = new Uint8Array(expectedDigest);
    let difference = 0;
    for (let index = 0; index < a.length; index++) {
      difference |= a[index] ^ b[index];
    }
    return difference === 0;
  }

  public static async createOwner(ctx: Context<HonoConfig>) {
    const env = ctx.env as Bindings;

    const config = resolvePrismConfig(
      env as unknown as Record<string, string | undefined>,
    );
    if (config.deploymentMode !== "self-hosted") {
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }

    // Rate limit before any work: the endpoint is public, so the limiter
    // is the first line of defense against brute-forcing the setup token.
    const attempt = SetupController.limiter.hit(`setup:${clientIpFrom(ctx)}`);
    if (!attempt.allowed) {
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }

    // Token gate: SETUP_TOKEN is mandatory on every self-hosted instance
    // (config validation enforces this at boot; this is the second line).
    const expectedToken = env.SETUP_TOKEN ?? "";
    if (!expectedToken) {
      return ctx.json(new ErrorResponse("setup_not_enabled").toJSON(), 503);
    }
    const provided = ctx.req.header("x-setup-token") ?? "";
    if (!provided || !(await SetupController.tokensEqual(provided, expectedToken))) {
      return ctx.json(new ErrorResponse("setup_token_required").toJSON(), 401);
    }

    const productDb = createProductDb(
      env as unknown as Record<string, string | undefined>,
    );
    const db = productDb.drizzle as never;

    let userCount: number;
    try {
      const rows = await productDb.query`SELECT id FROM "user" LIMIT 1`;
      userCount = rows.length;
    } catch {
      return ctx.json(new ErrorResponse("database_not_ready").toJSON(), 503);
    }

    if (userCount > 0) {
      // Bootstrap closed: hide the endpoint entirely.
      return ctx.json(new ErrorResponse("not_found").toJSON(), 404);
    }

    // Atomic claim with stale recovery. The table comes from migration
    // 0002; a missing table is an operator error, not a claim conflict.
    try {
      await SetupController.acquireClaim(productDb.query);
    } catch (error) {
      if (
        error instanceof Error &&
        /no such table|does not exist|relation.*does not exist/i.test(
          error.message,
        )
      ) {
        logger.warn(
          "setup",
          "setup_claim table is missing — apply migrations (yarn workspace prism-api db:migrate).",
        );
        return ctx.json(new ErrorResponse("database_not_ready").toJSON(), 503);
      }
      return ctx.json(new ErrorResponse("setup_in_progress").toJSON(), 409);
    }

    let body: { name?: string; email?: string; password?: string };
    try {
      body = await ctx.req.json<{
        name?: string;
        email?: string;
        password?: string;
      }>();
    } catch {
      await SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }

    const name = body.name?.trim() ?? "";
    const email = body.email?.trim().toLowerCase() ?? "";
    const password = body.password ?? "";

    if (!name || !email || !password) {
      await SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("invalid_request").toJSON(), 400);
    }
    if (password.length < 8) {
      await SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("weak_password").toJSON(), 400);
    }

    // One-time auth instance with signup enabled for the bootstrap request.
    const options = buildAuthOptions(
      env as unknown as Record<string, string | undefined>,
      db,
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
      await SetupController.releaseClaim(productDb.query);
      return ctx.json(new ErrorResponse("signup_failed").toJSON(), 400);
    }

    // Promote to ADMIN, mark the email verified (the verified-email
    // product guards otherwise block the first project), and provision
    // profile + personal workspace (Task 13: the workspace is a Better
    // Auth organization created through its server API — no session is
    // needed when userId is supplied).
    const userId = (result.user as { id: string }).id;
    try {
      await productDb.query`UPDATE "user" SET role = ${Roles.ADMIN}, email_verified = true WHERE id = ${userId}`;
      await provisionUserResources(db, {
        id: userId,
        name: result.user.name,
        email: result.user.email,
      });
      await createPersonalWorkspace(auth.api as never, {
        id: userId,
        name: result.user.name,
      });
    } catch (error) {
      // Roll back: a partially configured owner must not close setup.
      await SetupController.rollbackOwner(productDb.query, userId);
      logger.warn("setup", "owner promotion/provisioning failed, rolled back", {
        message: error instanceof Error ? error.message : error,
      });
      return ctx.json(new ErrorResponse("signup_failed").toJSON(), 500);
    }

    return ctx.json({ ok: true });
  }

  /**
   * Inserts the single claim row. On conflict it inspects the existing
   * row: a claim older than the TTL is stale (the previous request
   * crashed) and is removed before one retry; a fresh claim belongs to a
   * live request, so the caller reports the conflict.
   */
  private static async acquireClaim(
    query: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<Array<Record<string, unknown>>>,
  ): Promise<void> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await query`INSERT INTO setup_claim (id, claimed_at) VALUES (1, ${Date.now()})`;
        return;
      } catch (error) {
        if (attempt > 0) {
          throw error;
        }
        const rows = await query`SELECT claimed_at FROM setup_claim WHERE id = 1`;
        const claimedAt = Number(rows[0]?.claimed_at ?? 0);
        if (rows.length > 0 && Date.now() - claimedAt > CLAIM_TTL_MS) {
          await query`DELETE FROM setup_claim WHERE id = 1`;
          continue; // retry the insert once
        }
        throw error;
      }
    }
  }

  /** Removes the claim row so setup can be retried (failure path). */
  private static async releaseClaim(
    query: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<Array<Record<string, unknown>>>,
  ): Promise<void> {
    try {
      await query`DELETE FROM setup_claim WHERE id = 1`;
    } catch {
      // Claim cleanup is best-effort; the user-count check re-opens setup.
    }
  }

  /** Compensating transaction: undo the created account on failure. */
  private static async rollbackOwner(
    query: (
      strings: TemplateStringsArray,
      ...values: unknown[]
    ) => Promise<Array<Record<string, unknown>>>,
    userId: string,
  ): Promise<void> {
    try {
      await query`DELETE FROM session WHERE user_id = ${userId}`;
      await query`DELETE FROM account WHERE user_id = ${userId}`;
      await query`DELETE FROM verification WHERE identifier IN (SELECT email FROM "user" WHERE id = ${userId})`;
      await query`DELETE FROM "user" WHERE id = ${userId}`;
      await SetupController.releaseClaim(query);
    } catch (error) {
      logger.warn("setup", "rollback incomplete", {
        message: error instanceof Error ? error.message : error,
      });
    }
  }
}
