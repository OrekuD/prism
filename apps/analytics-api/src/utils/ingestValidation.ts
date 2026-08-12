import { INGEST_LIMITS } from "@prism/core";
import { z } from "zod";

/**
 * Server-owned runtime validation for POST /api/v2/ingest (task-9 §8).
 *
 * TypeScript types are NOT a trust boundary: every field is validated at
 * runtime against the SHARED limits from @prism/core, so an official-SDK
 * event can never be rejected as oversized (the SDK enforces the same
 * ceilings) while direct HTTP clients are rejected at these ceilings.
 *
 * Rejection is per event with coarse reason codes; envelope-level failures
 * use the coarse error codes in the ingest response.
 */

/** Rejected-event reason codes (never echo properties, keys, or values). */
export type IngestRejectReason =
  | "invalid-name"
  | "invalid-properties"
  | "invalid-timestamp"
  | "unsupported-type"
  | "too-large"
  | "invalid-event";

/** Validated (and not yet sanitized) event ready for persistence. */
export interface ValidatedEvent {
  eventId: string;
  type: "track";
  occurredAt: number;
  sessionId?: string;
  anonymousId?: string;
  name: string;
  properties: Record<string, unknown>;
  context?: Record<string, unknown>;
}

export type EventValidationResult =
  | { readonly ok: true; readonly event: ValidatedEvent }
  | { readonly ok: false; readonly reason: IngestRejectReason };

const eventSchema = z.object({
  schemaVersion: z.literal(INGEST_LIMITS.schemaVersion),
  eventId: z.string().min(1).max(128),
  type: z.literal("track"),
  occurredAt: z.number().finite(),
  sessionId: z.string().min(1).max(128).optional(),
  anonymousId: z.string().min(1).max(128).optional(),
  name: z.string(),
  properties: z.record(z.string(), z.unknown()).optional(),
  context: z.record(z.string(), z.unknown()).optional(),
});

const batchSchema = z.object({
  schemaVersion: z.literal(INGEST_LIMITS.schemaVersion),
  sentAt: z.number().finite().optional(),
  sdk: z
    .object({ name: z.string().min(1).max(64), version: z.string().min(1).max(64) })
    .optional(),
  events: z.array(z.unknown()).min(1).max(INGEST_LIMITS.maxBatchEvents),
});

/** Parse + structural validation of the batch envelope. */
export function parseBatchBody(body: string): { ok: true; batch: { events: unknown[] } } | { ok: false } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return { ok: false };
  }
  const result = batchSchema.safeParse(parsed);
  if (!result.success) return { ok: false };
  return { ok: true, batch: { events: result.data.events } };
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

/** Keys that must never appear in event properties (prototype pollution). */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

/**
 * Depth-limited, iterative-safe validation of a JSON value. JSON.parse
 * cannot produce undefined/functions/symbols/bigints, but it CAN produce
 * non-finite numbers (e.g. `1e400` → Infinity), so those are checked too.
 * Returns null when valid, otherwise the coarse reject reason.
 */
function validateJsonValue(value: unknown, depth: number): IngestRejectReason | null {
  if (typeof value === "string") {
    if (value.length > INGEST_LIMITS.maxStringLength) return "invalid-properties";
    return null;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return "invalid-properties";
    return null;
  }
  if (value === null || typeof value === "boolean") return null;
  if (Array.isArray(value)) {
    if (depth + 1 > INGEST_LIMITS.maxPropertyDepth) return "invalid-properties";
    for (const item of value) {
      const failure = validateJsonValue(item, depth + 1);
      if (failure) return failure;
    }
    return null;
  }
  if (typeof value === "object") {
    if (depth + 1 > INGEST_LIMITS.maxPropertyDepth) return "invalid-properties";
    for (const [key, entry] of Object.entries(value)) {
      if (DANGEROUS_KEYS.has(key)) return "invalid-properties";
      const failure = validateJsonValue(entry, depth + 1);
      if (failure) return failure;
    }
    return null;
  }
  return "invalid-properties";
}

/**
 * Validate one event. Structural failures → `invalid-event`; variant
 * mismatch → `unsupported-type`; name issues → `invalid-name`; timestamp
 * outside the documented window → `invalid-timestamp`; property-tree
 * failures → `invalid-properties`; serialized size over the shared cap →
 * `too-large`.
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
  // must run before any schema transformation.
  const rawProperties = (raw as Record<string, unknown>).properties;
  if (rawProperties !== undefined) {
    const propertyFailure = validateJsonValue(rawProperties, 0);
    if (propertyFailure) {
      return { ok: false, reason: propertyFailure };
    }
  }
  const parsed = eventSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, reason: "invalid-event" };
  }
  const event = parsed.data;

  const name = event.name;
  // Whitespace-only names and control characters are rejected; leading/
  // trailing whitespace is accepted (the SDK does not strip it either).
  const hasControlCharacter = [...name].some(
    (char) => char.charCodeAt(0) < 0x20 || char.charCodeAt(0) === 0x7f,
  );
  if (name.trim().length === 0 || hasControlCharacter) {
    return { ok: false, reason: "invalid-name" };
  }
  if (name.length > INGEST_LIMITS.maxNameLength) {
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

  const properties = event.properties ?? {};

  // Serialized size measured on the canonical round trip (client order).
  if (utf8Length(JSON.stringify(event)) > INGEST_LIMITS.maxEventBytes) {
    return { ok: false, reason: "too-large" };
  }

  return {
    ok: true,
    event: {
      eventId: event.eventId,
      type: event.type,
      occurredAt: event.occurredAt,
      sessionId: event.sessionId,
      anonymousId: event.anonymousId,
      name: event.name,
      properties,
      context: event.context,
    },
  };
}

/** Event ID for rejected events (may be absent on structurally invalid input). */
export function eventIdOf(raw: unknown): string {
  if (typeof raw === "object" && raw !== null && typeof (raw as { eventId?: unknown }).eventId === "string") {
    return (raw as { eventId: string }).eventId;
  }
  return "";
}
