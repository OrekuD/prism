import "./testEnv.js";
import { describe, expect, it } from "vitest";
import { isValidEventName, validateJsonValue } from "@prism-analytics/core";
import { NAME_CORPUS, PROPERTY_CORPUS, depthCase } from "./validation-corpus.js";
import { validateEvent } from "../utils/ingestValidation.js";

/**
 * Core/server validation parity (task-9 slice-4 review F3): the SAME
 * table-driven corpus runs through the core validators and the server's
 * per-event validator. Contract: every event the core accepts must be
 * accepted by the server — the official SDK can never construct a batch
 * the server rejects for name, property, or context rules.
 */

function serverEvent(name: unknown, properties: unknown) {
  return {
    schemaVersion: 2,
    eventId: "parity-1",
    type: "track",
    occurredAt: Date.now(),
    name,
    properties,
  };
}

describe("core/server validation parity corpus", () => {
  it("name corpus: identical verdicts on both sides", () => {
    for (const entry of NAME_CORPUS) {
      const coreOk = isValidEventName(entry.name);
      const serverOk = validateEvent(serverEvent(entry.name, {}), Date.now()).ok;
      expect(coreOk, `core name "${entry.label}"`).toBe(entry.valid);
      expect(serverOk, `server name "${entry.label}"`).toBe(entry.valid);
    }
  });

  it("property corpus: core-accepted events are always server-accepted", () => {
    for (const entry of PROPERTY_CORPUS) {
      // core side: the runtime value (or the JSON round trip)
      const coreValue = entry.runtime ?? entry.json;
      const coreOk = validateJsonValue(coreValue).ok;
      expect(coreOk, `core properties "${entry.label}"`).toBe(entry.valid);
      if (coreOk) {
        // parity direction that matters: accepted by core ⇒ accepted by server
        const serverOk = validateEvent(serverEvent("parity", entry.json), Date.now()).ok;
        expect(serverOk, `server must accept core-accepted "${entry.label}"`).toBe(true);
      }
    }
  });

  it("depth parity: 12 levels accepted, 13 rejected on both sides", () => {
    for (const levels of [12, 13]) {
      const { json } = depthCase(levels);
      const coreOk = validateJsonValue(json).ok;
      const serverOk = validateEvent(serverEvent("parity", json), Date.now()).ok;
      expect(coreOk, `core depth ${levels}`).toBe(levels <= 12);
      expect(serverOk, `server depth ${levels}`).toBe(levels <= 12);
    }
  });

  it("context gets the same strict policy as properties", () => {
    const deep = depthCase(13).json;
    const result = validateEvent(
      { ...serverEvent("parity", {}), context: deep },
      Date.now(),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("invalid-properties");
  });
});
