import { describe, expect, it } from "vitest";
import { STANDARD_EVENT_KEYS } from "@prism-analytics/types";
import { STANDARD_EVENT_DEFINITIONS } from "../standard-events";

/**
 * Task 21 R2-F6 — the assistant contract mirrors Task 19's canonical key
 * set because package boundaries forbid importing core from types (core
 * depends on types). This test fails closed on any drift in either
 * direction: every catalog key must appear exactly once in the contract
 * enum, and the contract must contain nothing else.
 */
describe("standard event key parity", () => {
  it("mirrors the 25-key Core catalog one-to-one", () => {
    const catalog = STANDARD_EVENT_DEFINITIONS.map((def) => def.key).sort();
    expect(catalog).toHaveLength(25);
    expect([...STANDARD_EVENT_KEYS].sort()).toEqual(catalog);
  });
});
