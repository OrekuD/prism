import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import { ErrorResponse } from "../network/responses/ErrorResponse.js";
import NeonDatabaseManager from "../managers/NeonDatabaseManager.js";

/**
 * Analytics key authentication (Task 13): an ingestion key belongs to ONE
 * source and, through it, exactly ONE project. Resolution is
 * source-first — the key row never carries a project or organization id
 * that could disagree with its source.
 *
 * - Only active keys authenticate; revoked keys are rejected like unknown
 *   keys (401, non-disclosing).
 * - Publishable WEB keys additionally enforce the source's allowed-origin
 *   policy against the request Origin (fallback: Referer). A mismatched
 *   origin is a 403 — the key is valid but the browser context is not.
 *   Native (iOS/Android/React Native) and secret server keys have no
 *   origin policy.
 * - The trusted source context (source_id, platform, key_type) is stored
 *   on the context and persisted on accepted telemetry; client payload
 *   fields can never override it.
 */
export const AnalyticsMiddleware = createMiddleware(
  async (ctx: Context, next) => {
    try {
      const authHeaderValue = ctx.req.header("Authorization");

      if (!authHeaderValue) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      // Exact Bearer scheme (F23): "Basic Bearer <key>", prefixed, or
      // suffixed junk must never authenticate.
      const match = /^Bearer\s+(\S+)$/.exec(authHeaderValue.trim());

      if (!match) {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      const apiKey = match[1] ?? "";

      const rows = (await NeonDatabaseManager.instance`
        SELECT
          k.source_id,
          k.key_type,
          k.status,
          s.project_id,
          s.platform,
          s.allowed_origins
        FROM project_api_keys k
        JOIN project_sources s ON s.id = k.source_id
        WHERE k.key = ${apiKey}
        LIMIT 1`) as Array<{
        source_id: string;
        key_type: string;
        status: string;
        project_id: string;
        platform: string;
        allowed_origins: string | null;
      }>;

      const key = rows[0];

      // Unknown OR revoked keys share one non-disclosing response.
      if (!key || key.status !== "active") {
        return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
      }

      // Origin policy for publishable web keys (F23-adjacent: the
      // browser can never be coerced into trusting a cross-origin page).
      if (key.key_type === "publishable" && key.platform === "web") {
        const origin = ctx.req.header("Origin") ?? ctx.req.header("Referer");
        const allowed = new Set(
          (key.allowed_origins
            ? (JSON.parse(key.allowed_origins) as string[])
            : []
          ).map((entry) => entry.replace(/\/$/, "")),
        );
        const candidate = origin
          ? new URL(origin).origin
          : null;
        if (!candidate || !allowed.has(candidate)) {
          return ctx.json(new ErrorResponse("origin_not_allowed").toJSON(), 403);
        }
      }

      ctx.set("projectId", key.project_id);
      ctx.set("sourceId", key.source_id);
      ctx.set("platform", key.platform);
      ctx.set("keyType", key.key_type);

      // last_used_at is best-effort bookkeeping; it must never fail a
      // request or reveal key existence.
      try {
        await NeonDatabaseManager.instance`
          UPDATE project_api_keys SET last_used_at = NOW() WHERE id = (
            SELECT id FROM project_api_keys WHERE key = ${apiKey} LIMIT 1
          )`;
      } catch {
        // bookkeeping only
      }
    } catch (error) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    await next();
  },
);
