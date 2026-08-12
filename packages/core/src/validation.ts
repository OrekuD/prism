import type { JsonObject, JsonValue } from "./contract";

/**
 * Local validation and sanitization for the v2 core (ADR 0002 §7, §5):
 * invalid CALLER INPUT throws a specific Error; credentials are redacted
 * deterministically; depth and length limits are enforced.
 */

/** Maximum event name length (matches the ingestion schema bound). */
export const MAX_EVENT_NAME_LENGTH = 128;

/** Throw when the event name is not a non-empty string within the limit. */
export function assertValidEventName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Event name must be a non-empty string");
  }
  if (name.length > MAX_EVENT_NAME_LENGTH) {
    throw new Error(`Event name exceeds ${MAX_EVENT_NAME_LENGTH} characters`);
  }
}

/** Default credential key patterns (case-insensitive). */
const DEFAULT_DENY_PATTERN =
  /(password|passcode|token|authorization|cookie|secret|api[_-]?key|credit[_-]?card|security[_-]?code|cvv|cvc|card[_-]?number)/i;

/** Stable redaction marker for sanitized values. */
export const REDACTED = "[REDACTED]";

/** Keys that must never appear in event properties (prototype pollution). */
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);

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
 * caller's object is never mutated.
 */
export function sanitizeProperties(
  properties: JsonObject,
  options: SanitizeOptions = {},
): JsonObject {
  const maxDepth = options.maxDepth ?? 12;
  const maxStringLength = options.maxStringLength ?? 10_000;
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

/** Throw when properties cannot be serialized to JSON (e.g. circular refs). */
export function assertJsonSerializable(properties: JsonObject | undefined): void {
  if (properties === undefined) return;
  try {
    JSON.stringify(properties);
  } catch {
    throw new Error("Event properties must contain only JSON values");
  }
}

/** Throw when the configured project key is missing. */
export function assertProjectKey(projectKey: string): void {
  if (typeof projectKey !== "string" || projectKey.trim().length === 0) {
    throw new Error("projectKey is required");
  }
}

/** Throw when the endpoint is not an http(s) origin. */
export function assertEndpoint(endpoint: string): void {
  if (!/^https?:\/\/[^\s]+$/.test(endpoint)) {
    throw new Error("endpoint must be an http(s) URL");
  }
}
