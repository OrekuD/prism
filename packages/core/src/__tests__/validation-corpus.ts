/**
 * Shared validation corpus (task-9 slice-4 review F3): ONE table-driven
 * corpus of valid and invalid event names + JSON property values, used by
 * BOTH the core package tests and the analytics ingestion tests so the
 * SDK and server can never drift apart.
 */

/** depth fixture: 12 nested objects, the 13th level is the failure case. */
function depthCase(levels: number): { json: unknown; valid: boolean } {
  let value: unknown = "leaf";
  for (let i = 0; i < levels; i += 1) value = { next: value };
  return { json: value, valid: levels <= 12 };
}

export interface NameCase {
  label: string;
  name: unknown;
  valid: boolean;
}

export const NAME_CORPUS: NameCase[] = [
  { label: "simple", name: "page_viewed", valid: true },
  { label: "dotted", name: "checkout.completed", valid: true },
  { label: "spaces inside", name: "order placed", valid: true },
  { label: "leading whitespace", name: "  padded", valid: true },
  { label: "unicode", name: "événement_💥", valid: true },
  { label: "exactly 128 chars", name: "a".repeat(128), valid: true },
  { label: "empty", name: "", valid: false },
  { label: "whitespace only", name: "   ", valid: false },
  { label: "129 chars", name: "a".repeat(129), valid: false },
  { label: "nul byte", name: "bad\u0000name", valid: false },
  { label: "tab", name: "bad\tname", valid: false },
  { label: "newline", name: "bad\nname", valid: false },
  { label: "del", name: "bad\u007fname", valid: false },
  { label: "not a string", name: 42, valid: false },
  { label: "null", name: null, valid: false },
];

export interface PropertyCase {
  label: string;
  /** JSON-safe representation for transmission (server side). */
  json: unknown;
  /** Runtime value for the core side (may contain non-JSON values). */
  runtime?: unknown;
  valid: boolean;
}

export const PROPERTY_CORPUS: PropertyCase[] = [
  { label: "flat", json: { a: 1, b: "two", c: true, d: null }, valid: true },
  { label: "nested", json: { user: { id: 7, tags: ["x", "y"] } }, valid: true },
  { label: "unicode string", json: { s: "héllo 💥" }, valid: true },
  { label: "10k string", json: { s: "x".repeat(10_000) }, valid: true },
  { label: "100 keys", json: Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`k${i}`, i])), valid: true },
  { label: "100 elements", json: { arr: Array.from({ length: 100 }, (_, i) => i) }, valid: true },
  { label: "depth 12", json: depthCase(12).json, valid: true },
  { label: "depth 13", json: depthCase(13).json, valid: false },
  { label: "string 10 001", json: { s: "x".repeat(10_001) }, valid: false },
  { label: "101 keys", json: Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`k${i}`, i])), valid: false },
  { label: "101 elements", json: { arr: Array.from({ length: 101 }, (_, i) => i) }, valid: false },
  { label: "non-finite number", json: JSON.parse('{"n":1e400}'), runtime: { n: Number.POSITIVE_INFINITY }, valid: false },
  { label: "nan", runtime: { n: Number.NaN }, json: null, valid: false },
  { label: "undefined value", runtime: { u: undefined }, json: null, valid: false },
  { label: "function value", runtime: { f: () => 1 }, json: null, valid: false },
  { label: "symbol value", runtime: { s: Symbol("x") }, json: null, valid: false },
  { label: "bigint value", runtime: { b: BigInt("10") }, json: null, valid: false },
  { label: "date instance", runtime: { d: new Date() }, json: null, valid: false },
  { label: "class instance", runtime: { c: new (class Box {})() }, json: null, valid: false },
  { label: "accessor", runtime: (() => { const o: Record<string, unknown> = {}; Object.defineProperty(o, "get", { get: () => 1, enumerable: true }); return { o }; })(), json: null, valid: false },
  { label: "cyclic", runtime: (() => { const c: Record<string, unknown> = {}; c.self = c; return c; })(), json: null, valid: false },
  { label: "dangerous key", json: JSON.parse('{"__proto__":{"x":1}}'), runtime: null, valid: false },
  { label: "dangerous constructor", json: JSON.parse('{"constructor":{"x":1}}'), valid: false },
  { label: "dangerous prototype", json: JSON.parse('{"prototype":{"x":1}}'), valid: false },
];

export { depthCase };

