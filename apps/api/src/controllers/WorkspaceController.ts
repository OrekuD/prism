import type { Context } from "hono";
import type { HonoConfig } from "../types/types";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { clientIpFrom, RateLimiter } from "../utils/RateLimiter";
import { getAuth } from "../auth/auth";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITABLE_ROLES = new Set(["admin", "member"]);
const MAX_INVITATIONS_PER_CALL = 50;

interface BatchInvitation {
  email: string;
  role: string;
}

/**
 * Per-IP throttle: invites are owner/admin actions, but the endpoint is
 * session-authenticated email egress — cap abuse without punishing a
 * workspace admin doing a bulk paste (30 / 15 min).
 */
const inviteLimiter = new RateLimiter(15 * 60 * 1000, 30);

/**
 * Batch member invitations — POST /api/v1/workspace/invitations.
 *
 * Body: { organizationId, invitations: [{ email, role }] } (max 50).
 * Each entry is processed through Better Auth's createInvitation server
 * API with the caller's session headers, so authorization (owner/admin
 * of the target workspace), already-a-member, and already-pending checks
 * are enforced identically to the single-invite client path.
 *
 * Never fails wholesale: returns per-entry results so the UI can show
 * which emails failed and why.
 */
export class WorkspaceController {
  public static async inviteMembers(ctx: Context<HonoConfig>) {
    const attempt = inviteLimiter.hit(`invitations:${clientIpFrom(ctx)}`);
    if (!attempt.allowed) {
      ctx.header("Retry-After", String(attempt.retryAfterSeconds));
      return ctx.json(new ErrorResponse("rate_limited").toJSON(), 429);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    let body: {
      organizationId?: unknown;
      invitations?: unknown;
    };
    try {
      body = await ctx.req.json();
    } catch {
      return ctx.json(new ErrorResponse("invalid_body").toJSON(), 400);
    }

    const organizationId =
      typeof body.organizationId === "string" ? body.organizationId.trim() : "";
    const invitations = Array.isArray(body.invitations) ? body.invitations : [];

    if (!organizationId) {
      return ctx.json(new ErrorResponse("organization_required").toJSON(), 400);
    }
    if (invitations.length === 0 || invitations.length > MAX_INVITATIONS_PER_CALL) {
      return ctx.json(
        new ErrorResponse(
          `invitations_must_be_1_to_${MAX_INVITATIONS_PER_CALL}`,
        ).toJSON(),
        400,
      );
    }

    // Validate and normalize before touching Better Auth.
    const normalized: BatchInvitation[] = [];
    const seen = new Set<string>();
    const results: Array<{
      email: string;
      status: "sent" | "error";
      error?: string;
    }> = [];
    for (const raw of invitations) {
      const email =
        typeof (raw as BatchInvitation)?.email === "string"
          ? (raw as BatchInvitation).email.trim().toLowerCase()
          : "";
      const role = typeof (raw as BatchInvitation)?.role === "string"
        ? (raw as BatchInvitation).role.trim()
        : "";
      if (!EMAIL_PATTERN.test(email) || email.length > 320) {
        results.push({ email, status: "error", error: "invalid_email" });
        continue;
      }
      if (!INVITABLE_ROLES.has(role)) {
        results.push({ email, status: "error", error: "invalid_role" });
        continue;
      }
      if (seen.has(email)) {
        results.push({ email, status: "error", error: "duplicate_in_batch" });
        continue;
      }
      seen.add(email);
      normalized.push({ email, role });
    }

    const auth = getAuth(ctx.env);
    // getAuth's type is the base Auth (no plugin inference), but the
    // organization plugin's endpoints exist at runtime — same pattern as
    // provision.ts's AuthLike.
    const api = auth.api as unknown as {
      createInvitation: (args: {
        body: { organizationId: string; email: string; role: string };
        headers: Headers;
      }) => Promise<unknown>;
    };
    for (const invitation of normalized) {
      try {
        // Session headers enforce the caller's owner/admin permission for
        // the target organization — identical to the single-invite path.
        await api.createInvitation({
          body: {
            organizationId,
            email: invitation.email,
            role: invitation.role,
          },
          headers: ctx.req.raw.headers,
        });
        results.push({ email: invitation.email, status: "sent" });
      } catch (error) {
        const message = String(
          (error as { message?: unknown })?.message ?? "invitation_failed",
        );
        results.push({
          email: invitation.email,
          status: "error",
          error: message,
        });
      }
    }

    return ctx.json({ results });
  }
}
