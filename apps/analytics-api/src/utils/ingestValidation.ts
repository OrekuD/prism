import { INGEST_LIMITS, isValidEventName, validateJsonValue, type WireContext } from "@prism-analytics/core";
import { z } from "zod";

/**
 * Server-owned runtime validation for POST /api/v2/ingest (task-9 §8,
 * slice-4 review F3/F4).
 *
 * TypeScript types are NOT a trust boundary: every field is validated at
 * runtime against the SHARED limits and validators from @prism-analytics/core (the
 * same implementation the SDK uses), so an official-SDK event can never be
 * rejected for name, property, or context rules while direct HTTP clients
 * are rejected at the same ceilings.
 *
 * Rejection is per event with coarse reason codes; envelope-level failures
 * use the coarse error codes in the ingest response. Never echo submitted
 * keys or values.
 */

/** Rejected-event reason codes (never echo properties, keys, or values). */
export type IngestRejectReason =
  | "invalid-name"
  | "invalid-properties"
  | "invalid-timestamp"
  | "unsupported-type"
  | "too-large"
  | "invalid-event"
  // Task 17: reserved page-view boundary rejections.
  | "page-view-requires-web-source"
  | "invalid-page-view"
  | "page-view-host-mismatch"
  // Task 18: reserved mobile boundary rejections.
  | "mobile-record-requires-react-native-source"
  | "mobile-record-requires-session"
  | "invalid-mobile-screen"
  | "invalid-mobile-lifecycle";

/** Validated (and not yet sanitized) event ready for persistence. */
export interface ValidatedEvent {
  eventId: string;
  type: "track";
  schemaVersion: number;
  occurredAt: number;
  sessionId?: string;
  anonymousId?: string;
  /** Developer-supplied external user id (v3 events, task-10 §4). */
  userId?: string;
  name: string;
  properties: Record<string, unknown>;
  context?: WireContext;
}

/** Validated identify operation (task-10 §4). */
export interface ValidatedIdentityOp {
  opId: string;
  userId: string;
  anonymousId: string;
  traits?: Record<string, unknown>;
  unset?: string[];
  occurredAt: number;
}

export type EventValidationResult =
  | { readonly ok: true; readonly event: ValidatedEvent }
  | { readonly ok: false; readonly reason: IngestRejectReason };

const eventSchema = z.object({
  // v2 (anonymous) and v3 (with developer-supplied userId) events are
  // both accepted — never silently reinterpreted (task-10 §4).
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  eventId: z.string().min(1).max(128),
  type: z.literal("track"),
  occurredAt: z.number().finite(),
  sessionId: z.string().min(1).max(128).optional(),
  anonymousId: z.string().min(1).max(128).optional(),
  userId: z.string().min(1).max(256).optional(),
  name: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const identityOpSchema = z.object({
  opId: z.string().min(1).max(128),
  userId: z.string().min(1).max(256),
  anonymousId: z.string().min(1).max(128),
  traits: z.record(z.string(), z.unknown()).optional(),
  unset: z.array(z.string().min(1).max(128)).max(50).optional(),
  occurredAt: z.number().finite(),
});

const batchSchema = z.object({
  // The envelope is versioned: v2 (events only) and v3 (events + identity
  // operations) — explicit versions, never silent reinterpretation.
  schemaVersion: z.union([z.literal(2), z.literal(3)]),
  sentAt: z.number().finite().optional(),
  sdk: z
    .object({ name: z.string().min(1).max(64), version: z.string().min(1).max(64) })
    .optional(),
  identity: z.array(z.unknown()).max(INGEST_LIMITS.maxBatchEvents).optional(),
  // F2: identity-only v3 envelopes are valid — events may be empty when
  // identity operations are present (the SDK delivers identify-only
  // flushes).
  events: z.array(z.unknown()).min(0).max(INGEST_LIMITS.maxBatchEvents),
}).refine(
  (batch) => batch.events.length > 0 || (batch.identity?.length ?? 0) > 0,
  { message: "batch must contain events or identity operations" },
);

/** Parsed batch with the authoritative batch-level SDK identity. */
export interface ParsedBatch {
  events: unknown[];
  identity?: unknown[];
  sdk?: { name: string; version: string };
}

/** Parse + structural validation of the batch envelope. */
export function parseBatchBody(
  body: string,
): { ok: true; batch: ParsedBatch } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false };
  }
  const result = batchSchema.safeParse(parsed);
  if (!result.success) return { ok: false };
  return {
    ok: true,
    batch: {
      events: result.data.events,
      identity: result.data.identity,
      sdk: result.data.sdk,
    },
  };
}

/** Structural validation of one identify operation. */
export function validateIdentityOp(
  raw: unknown,
): { ok: true; op: ValidatedIdentityOp } | { ok: false } {
  const result = identityOpSchema.safeParse(raw);
  if (!result.success) return { ok: false };
  const data = result.data;
  // traits/values + unset keys are validated by the same rules the SDK
  // uses; the operation is coarse-rejected when they are not JSON-safe.
  if (data.traits !== undefined) {
    const validation = validateJsonValue(data.traits, {
      maxDepth: INGEST_LIMITS.maxPropertyDepth,
      maxStringLength: INGEST_LIMITS.maxStringLength,
      maxKeys: INGEST_LIMITS.maxPropertyKeys,
      maxArrayElements: INGEST_LIMITS.maxArrayElements,
    });
    if (!validation.ok) return { ok: false };
  }
  return {
    ok: true,
    op: {
      opId: data.opId,
      userId: data.userId,
      anonymousId: data.anonymousId,
      ...(data.traits !== undefined ? { traits: data.traits } : {}),
      ...(data.unset !== undefined ? { unset: data.unset } : {}),
      occurredAt: data.occurredAt,
    },
  };
}

/** UTF-8 encoded byte length (no platform globals; mirrors the core). */
export function utf8Length(value: string): number {
  let bytes = 0;
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < value.length) {
      const next = value.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else {
        bytes += 3;
      }
    } else {
      bytes += 3;
    }
  }
  return bytes;
}

/**
 * Shared strict-JSON validation for BOTH properties and context (review
 * F4): iterative traversal (explicit work stack) so hostile nesting depth
 * yields a controlled rejection, never a native RangeError. Returns null
 * when valid, otherwise the coarse reject reason.
 */
function validateJsonObject(
  value: unknown,
): IngestRejectReason | null {
  const result = validateJsonValue(value, {
    maxDepth: INGEST_LIMITS.maxPropertyDepth,
    maxStringLength: INGEST_LIMITS.maxStringLength,
    maxKeys: INGEST_LIMITS.maxPropertyKeys,
    maxArrayElements: INGEST_LIMITS.maxArrayElements,
  });
  return result.ok ? null : "invalid-properties";
}

/**
 * Validate one event. Structural failures → `invalid-event`; variant
 * mismatch → `unsupported-type`; name issues → `invalid-name`; timestamp
 * outside the documented window → `invalid-timestamp`; property/context
 * tree failures → `invalid-properties`; serialized size over the shared
 * cap → `too-large`.
 */
export function validateEvent(raw: unknown, now: number): EventValidationResult {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, reason: "invalid-event" };
  }
  // Distinguish variant mismatch from other structural failures.
  if ("type" in raw && raw.type !== "track") {
    return { ok: false, reason: "unsupported-type" };
  }
  // Validate the property tree on the RAW event: zod's record parse cannot
  // carry an own `__proto__` key faithfully, so prototype-pollution checks
  // must run before any schema transformation. Context gets the same
  // strict JSON policy as properties (F4).
  const record = raw as Record<string, unknown>;
  if (record.properties !== undefined) {
    const propertyFailure = validateJsonObject(record.properties);
    if (propertyFailure) {
      return { ok: false, reason: propertyFailure };
    }
  }
  if (record.context !== undefined) {
    const contextFailure = validateJsonObject(record.context);
    if (contextFailure) {
      return { ok: false, reason: contextFailure };
    }
  }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-event" };
  }
  const event = parsed.data;

  // Shared name rules (the SDK uses the same validator — parity).
  if (!isValidEventName(event.name)) {
    return { ok: false, reason: "invalid-name" };
  }

  // Bounded offline delivery: reject unreasonable future clock skew and
  // events older than the documented window (retention owns older data).
  if (
    event.occurredAt > now + INGEST_LIMITS.maxFutureSkewMs ||
    event.occurredAt < now - INGEST_LIMITS.maxPastAgeMs
  ) {
    return { ok: false, reason: "invalid-timestamp" };
  }

  // Serialized size measured on the RAW event (release review): a zod
  // parse strips unknown fields, so measuring the parsed value would let
  // an oversized raw event sneak through — count the bytes the client
  // actually sent.
  if (utf8Length(JSON.stringify(raw)) > INGEST_LIMITS.maxEventBytes) {
    return { ok: false, reason: "too-large" };
  }

  return {
    ok: true,
    event: {
      eventId: event.eventId,
      type: event.type,
      schemaVersion: event.schemaVersion,
      occurredAt: event.occurredAt,
      sessionId: event.sessionId,
      anonymousId: event.anonymousId,
      ...(event.userId !== undefined ? { userId: event.userId } : {}),
      name: event.name,
      properties: event.properties ?? {},
      context: event.context as WireContext | undefined,
    },
  };
}

/** Event ID for rejected events (may be absent on structurally invalid input). */
export function eventIdOf(raw: unknown): string {
  if (
    typeof raw === "object" &&
    raw !== null &&
    typeof (raw as { eventId?: unknown }).eventId === "string"
  ) {
    return (raw as { eventId: string }).eventId;
  }
  return "";
}
