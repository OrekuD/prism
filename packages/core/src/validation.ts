import type { JsonObject } from "./contract";

/**
 * Local validation for the v2 core (ADR 0002 §7): invalid CALLER INPUT
 * throws a specific Error during track()/factory setup; consent, shutdown,
 * and queue-capacity conditions are results, never exceptions.
 */

/** Throw when the event name is not a non-empty string. */
export function assertValidEventName(name: string): void {
  if (typeof name !== "string" || name.trim().length === 0) {
    throw new Error("Event name must be a non-empty string");
  }
}

/** Throw when properties cannot be serialized to JSON (e.g. circular refs). */
export function assertJsonSerializable(properties: JsonObject | undefined): void {
  if (properties === undefined) return;
  try {
    JSON.stringify(properties);
  } catch {
    throw new Error("Event properties must be JSON-serializable");
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
