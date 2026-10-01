import type { Context } from "hono";
import type { HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { clientIpFrom, RateLimiter } from "../utils/RateLimiter";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class AuthController {
  /**
   * Per-IP throttle for the public signup duplicate check. Generous enough
   * for a shared office NAT (60 / 15 min) while making bulk email-list
   * probing through this endpoint slow and noisy.
   */
  private static emailAvailableLimiter = new RateLimiter(15 * 60 * 1000, 60);

  /**
   * Signup duplicate check — GET /api/v1/auth/email-available?email=.
   *
   * Returns { available } so the signup UI can route existing users to
   * sign-in before they invest in the rest of the form. The boolean is an
   * accepted product tradeoff (Option A); the response shape is consistent
   * for both outcomes, invalid input is a 400, and abuse is bounded by the
   * per-IP rate limit. The authoritative duplicate check remains the
   * signup submit itself (USER_ALREADY_EXISTS), which also covers the
   * race between this check and account creation.
   */
  public static async emailAvailable(ctx: Context<HonoConfig>) {
    const attempt = AuthController.emailAvailableLimiter.hit(
      `email-available:${clientIpFrom(ctx)}`,
    );
    if (!attempt.allowed) {
      ctx.header("Retry-After", String(attempt.retryAfterSeconds));
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }

    const email = (ctx.req.query("email") ?? "").trim().toLowerCase();
    if (!EMAIL_PATTERN.test(email) || email.length > 320) {
      return ctx.json(new ErrorResponse("invalid_email").toJSON(), 400);
    }

    try {
      const rows = (await DatabaseManager.getInstance(
        ctx,
      )`SELECT 1 FROM "user" WHERE lower(email) = ${email} LIMIT 1`) as unknown[];
      return ctx.json({ available: rows.length === 0 });
    } catch {
      // Fail open as "available": signup submit is the authoritative
      // duplicate check, so a transient DB error must not block signup.
      return ctx.json({ available: true });
    }
  }
}
