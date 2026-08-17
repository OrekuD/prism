import type { JsonObject, JsonValue } from "./contract";
import { INGEST_LIMITS } from "./limits";

/**
 * Local validation and sanitization for the v2 core (ADR 0002 §7, §5):
 * invalid CALLER INPUT throws a specific Error; credentials are redacted
 * deterministically; depth, string, key, and element limits are enforced.
 *
 * The validators here are the ONE shared implementation used by the core
 * AND the analytics ingestion service (task-9 slice-4 review F3/F4): the
 * server reuses `isValidEventName` and `validateJsonValue`, so the SDK can
 * never produce an envelope the server rejects for name or property rules.
 */

/** Throw when the event name is not valid per the shared rules. */
export function assertValidEventName(name: string): void {
  const validation = validateEventName(name);
  if (!validation.ok) {
    throw new Error(validation.message);
  }
}

/**
 * Shared event-name rules (used by core AND the ingestion server):
 * non-empty string, whitespace-only rejected, ≤ 128 characters, no control
 * characters. Leading/trailing whitespace is accepted — the server must
 * accept any name the SDK can produce.
 */
export function isValidEventName(name: unknown): boolean {
  return validateEventName(name).ok;
}

function validateEventName(
  name: unknown,
): { ok: true } | { ok: false; message: string } {
  if (typeof name !== "string" || name.trim().length === 0) {
    return { ok: false, message: "Event name must be a non-empty string" };
  }
  if (name.length > INGEST_LIMITS.maxNameLength) {
    return {
      ok: false,
      message: `Event name exceeds ${INGEST_LIMITS.maxNameLength} characters`,
    };
  }
  for (let i = 0; i < name.length; i += 1) {
    const code = name.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) {
      return { ok: false, message: "Event name must not contain control characters" };
    }
  }
  return { ok: true };
}

/** Default credential key patterns (case-insensitive). */
const DEFAULT_DENY_PATTERN =
  /(password|passcode|token|authorization|cookie|secret|api[_-]?key|credit[_-]?card|security[_-]?code|cvv|cvc|card[_-]?number)/i;

/** Stable redaction marker for sanitized values. */
export const REDACTED = "[REDACTED]";

/** Keys that must never appear in event properties (prototype pollution). */
export const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

export interface SanitizeOptions {
  /** Extra key names treated as credentials (case-insensitive matches). */
  denyList?: string[];
  /** Maximum property nesting depth. Default 12. */
  maxDepth?: number;
  /** Maximum string length for any property value. Default 10_000. */
  maxStringLength?: number;
}

/**
 * Deterministic property sanitizer (task-9 §4): walks the properties tree,
 * replaces values under credential keys with `[REDACTED]`, and enforces
 * depth/string limits with specific errors. Arrays are walked too; the
 * caller's object is never mutated. Runs AFTER `validateJsonValue`, so the
 * tree is already bounded (depth ≤ 12) and recursion cannot overflow.
 */
export function sanitizeProperties(
  properties: JsonObject,
  options: SanitizeOptions = {},
): JsonObject {
  const maxDepth = options.maxDepth ?? INGEST_LIMITS.maxPropertyDepth;
  const maxStringLength = options.maxStringLength ?? INGEST_LIMITS.maxStringLength;
  const custom = (options.denyList ?? []).map((entry) => entry.toLowerCase());
  const isSensitiveKey = (key: string): boolean => {
    if (DEFAULT_DENY_PATTERN.test(key)) return true;
    return custom.includes(key.toLowerCase());
  };

  const walk = (value: unknown, depth: number): JsonValue => {
    if (depth > maxDepth) {
      throw new Error(`Event properties exceed maximum depth (${maxDepth})`);
    }
    if (value === undefined || typeof value === "function" || typeof value === "symbol" || typeof value === "bigint") {
      // Runtime-only values are not JSON — reject rather than silently drop.
      throw new Error("Event properties must contain only JSON values");
    }
    if (typeof value === "string") {
      if (value.length > maxStringLength) {
        throw new Error(`Event property string exceeds maximum length (${maxStringLength})`);
      }
      return value;
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, depth + 1));
    }
    if (value !== null && typeof value === "object") {
      const out: JsonObject = {};
      for (const [key, entry] of Object.entries(value)) {
        if (DANGEROUS_KEYS.has(key)) {
          throw new Error(`Event properties contain a dangerous key ("${key}")`);
        }
        out[key] = isSensitiveKey(key) ? REDACTED : walk(entry, depth + 1);
      }
      return out;
    }
    return value as JsonValue;
  };

  return walk(properties, 0) as JsonObject;
}

/** Coarse machine-readable rejection reasons for JSON validation. */
export type JsonValidationReason =
  | "too-deep"
  | "string-too-long"
  | "too-many-keys"
  | "too-many-elements"
  | "non-finite-number"
  | "non-plain-object"
  | "accessor"
  | "cyclic"
  | "dangerous-key"
  | "invalid-value";

export type JsonValidationResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: JsonValidationReason };

interface WorkItem {
  value: unknown;
  depth: number;
}

/**
 * Strict JSON value validation — ITERATIVE (explicit work stack) so a
 * hostile nesting depth can never overflow the native call stack before a
 * controlled validation error is returned (task-9 slice-4 review F4).
 *
 * Accepts only: null, booleans, finite numbers, strings (≤ limit), arrays
 * (≤ element limit), and PLAIN objects (≤ key limit) whose values are JSON
 * values. Rejects: undefined, functions, symbols, bigint, non-finite
 * numbers, Date, class instances, accessors, cyclic structures, dangerous
 * keys, and everything beyond the shared depth/string/key/element limits.
 *
 * Deliberately does NOT use JSON.stringify as a validator — serialization
 * silently converts or discards unsupported JavaScript values.
 */
export function validateJsonValue(
  value: unknown,
  options: {
    maxDepth?: number;
    maxStringLength?: number;
    maxKeys?: number;
    maxArrayElements?: number;
  } = {},
): JsonValidationResult {
  const maxDepth = options.maxDepth ?? INGEST_LIMITS.maxPropertyDepth;
  const maxStringLength = options.maxStringLength ?? INGEST_LIMITS.maxStringLength;
  const maxKeys = options.maxKeys ?? INGEST_LIMITS.maxPropertyKeys;
  const maxArrayElements = options.maxArrayElements ?? INGEST_LIMITS.maxArrayElements;

  const visited = new Set<object>();
  const stack: WorkItem[] = [{ value, depth: 0 }];

  while (stack.length > 0) {
    const item = stack.pop() as WorkItem;
    const { value: current, depth } = item;
    if (depth > maxDepth) {
      return { ok: false, reason: "too-deep" };
    }
    if (current === null || typeof current === "boolean") {
      continue;
    }
    if (typeof current === "string") {
      if (current.length > maxStringLength) {
        return { ok: false, reason: "string-too-long" };
      }
      continue;
    }
    if (typeof current === "number") {
      if (!Number.isFinite(current)) {
        return { ok: false, reason: "non-finite-number" };
      }
      continue;
    }
    if (
      current === undefined ||
      typeof current === "function" ||
      typeof current === "symbol" ||
      typeof current === "bigint"
    ) {
      return { ok: false, reason: "invalid-value" };
    }
    if (typeof current !== "object") {
      return { ok: false, reason: "invalid-value" };
    }
    if (visited.has(current)) {
      return { ok: false, reason: "cyclic" };
    }
    visited.add(current);
    if (Array.isArray(current)) {
      if (current.length > maxArrayElements) {
        return { ok: false, reason: "too-many-elements" };
      }
      for (const entry of current) {
        stack.push({ value: entry, depth: depth + 1 });
      }
      continue;
    }
    // Plain-object check: Date, class instances, Maps, etc. are rejected.
    const proto = Object.getPrototypeOf(current);
    if (proto !== Object.prototype && proto !== null) {
      return { ok: false, reason: "non-plain-object" };
    }
    const keys = Object.keys(current);
    if (keys.length > maxKeys) {
      return { ok: false, reason: "too-many-keys" };
    }
    for (const key of keys) {
      if (DANGEROUS_KEYS.has(key)) {
        return { ok: false, reason: "dangerous-key" };
      }
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (descriptor && (descriptor.get !== undefined || descriptor.set !== undefined)) {
        return { ok: false, reason: "accessor" };
      }
      stack.push({
        value: (current as Record<string, unknown>)[key],
        depth: depth + 1,
      });
    }
  }
  return { ok: true };
}

/** Throw when properties are not strict JSON values (specific reason). */
export function assertJsonSerializable(properties: JsonObject | undefined): void {
  if (properties === undefined) return;
  const result = validateJsonValue(properties);
  if (!result.ok) {
    throw new Error(`Event properties must contain only JSON values (${result.reason})`);
  }
}

/** Throw when the configured project key is missing. */
export function assertSourceKey(sourceKey: string): void {
  if (typeof sourceKey !== "string" || sourceKey.trim().length === 0) {
    throw new Error("sourceKey is required");
  }
}

/** Throw when the endpoint is not an http(s) origin. */
export function assertEndpoint(endpoint: string): void {
  if (!/^https?:\/\/[^\s]+$/.test(endpoint)) {
    throw new Error("endpoint must be an http(s) URL");
  }
}
