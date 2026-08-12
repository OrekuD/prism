import {
  INGEST_LIMITS,
  sanitizeProperties,
  type IngestResponseBody,
  type IngestResult,
  type JsonObject,
} from "@prism/core";
import type { Context } from "hono";
import { config } from "dotenv";
import TursoDatabaseManager from "../managers/TursoDatabaseManager.js";
import { RateLimiter } from "../utils/RateLimiter.js";
import { logger } from "../utils/logger.js";
import {
  eventIdOf,
  parseBatchBody,
  utf8Length,
  validateEvent,
} from "../utils/ingestValidation.js";

config();

/**
 * Event-weighted abuse protection (task-9 §8): the per-IP request limiter
 * bounds REQUEST volume; this bounds EVENTS per project so batching cannot
 * multiply the effective ingestion allowance by the batch size. The quota
 * is a deliberate configured default (env-overridable).
 */
const EVENT_QUOTA_PER_MINUTE = Number(process.env.ANALYTICS_EVENT_RATE_LIMIT) || 10_000;
export const eventLimiter = new RateLimiter(60_000, EVENT_QUOTA_PER_MINUTE);

/** Coarse error envelope — never echoes payloads, keys, or values. */
interface IngestErrorBody {
  readonly ok: false;
  readonly error: { readonly code: string; readonly message: string };
}

const INSERT_EVENT_SQL = `
  INSERT INTO events_v2
    (id, project_id, type, name, schema_version, occurred_at, received_at,
     session_id, anonymous_id, properties, context)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  ON CONFLICT (project_id, id) DO NOTHING
`;

export class IngestController {
  /**
   * POST /api/v2/ingest — the versioned, idempotent batch ingestion API
   * (ADR 0002 §2, task-9 §8). The project is derived from the authenticated
   * write key; client-provided ownership fields are ignored.
   */
  public static async ingest(ctx: Context) {
    // Content type + request byte limits BEFORE parsing/allocating.
    const contentType = ctx.req.header("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      return ctx.json(
        ingestError("invalid-envelope", "content-type must be application/json"),
        400,
      );
    }
    const contentLength = Number(ctx.req.header("content-length") ?? "0");
    if (Number.isFinite(contentLength) && contentLength > INGEST_LIMITS.maxBatchBytes) {
      return ctx.json(ingestError("too-large", "request exceeds the byte limit"), 413);
    }

    const body = await ctx.req.text().catch(() => "");
    if (utf8Length(body) > INGEST_LIMITS.maxBatchBytes) {
      return ctx.json(ingestError("too-large", "request exceeds the byte limit"), 413);
    }

    const parsed = parseBatchBody(body);
    if (!parsed.ok) {
      return ctx.json(ingestError("invalid-envelope", "batch envelope is invalid"), 400);
    }

    // The project id is derived from the API key, never from the body.
    const projectId = ctx.get("projectId") ?? "";

    // Event-weighted quota first — a big batch must not dodge the limit.
    const { allowed, retryAfterSeconds } = eventLimiter.hit(
      projectId,
      parsed.batch.events.length,
    );
    if (!allowed) {
      ctx.header("Retry-After", String(retryAfterSeconds));
      return ctx.json(ingestError("rate-limited", "event quota exceeded"), 429);
    }

    const now = Date.now();
    const results: IngestResult[] = [];

    for (let index = 0; index < parsed.batch.events.length; index += 1) {
      const raw = parsed.batch.events[index];
      const validation = validateEvent(raw, now);
      if (!validation.ok) {
        results.push({
          index,
          id: eventIdOf(raw),
          status: "rejected",
          reason: validation.reason,
        });
        continue;
      }
      const event = validation.event;

      // The SDK sanitizes; direct HTTP clients do not — sanitize on the
      // server too (defense in depth, same rules and limits as the core).
      const sanitized = sanitizeProperties(event.properties as JsonObject, {
        maxDepth: INGEST_LIMITS.maxPropertyDepth,
        maxStringLength: INGEST_LIMITS.maxStringLength,
      });

      // Conflict-safe insert: the UNIQUE (project_id, id) constraint makes
      // transport retries idempotent — a replayed event becomes a
      // "duplicate", never a second row.
      const result = await TursoDatabaseManager.instance.execute({
        sql: INSERT_EVENT_SQL,
        args: [
          event.eventId,
          projectId,
          event.type,
          event.name,
          INGEST_LIMITS.schemaVersion,
          event.occurredAt,
          now,
          event.sessionId ?? null,
          event.anonymousId ?? null,
          JSON.stringify(sanitized),
          event.context ? JSON.stringify(event.context) : null,
        ],
      });

      results.push({
        index,
        id: event.eventId,
        status: result.rowsAffected === 0 ? "duplicate" : "accepted",
      });
    }

    const counts = {
      accepted: results.filter((r) => r.status === "accepted").length,
      duplicate: results.filter((r) => r.status === "duplicate").length,
      rejected: results.filter((r) => r.status === "rejected").length,
    };
    // Safe correlation log: counts + ids only, never properties or values.
    logger.info("analytics:ingest", "v2 batch ingested", {
      projectId,
      batchSize: results.length,
      ...counts,
    });

    return ctx.json({ ok: true, results } satisfies IngestResponseBody, 200);
  }
}

function ingestError(code: string, message: string): IngestErrorBody {
  return { ok: false, error: { code, message } };
}
