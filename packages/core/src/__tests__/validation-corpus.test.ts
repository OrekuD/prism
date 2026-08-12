import { describe, expect, it } from "vitest";
import { isValidEventName, validateJsonValue } from "../index";
import { NAME_CORPUS, PROPERTY_CORPUS, depthCase } from "../../../../apps/analytics-api/src/__tests__/validation-corpus.js";

/**
 * Core-side corpus test (task-9 slice-4 review F3): the SHARED corpus
 * lives in the analytics package (so the analytics tsc build stays
 * self-contained); this suite runs the SAME corpus through the core
 * validators. The parity suite in analytics proves the server accepts
 * everything the core accepts.
 */
describe("core validators against the shared corpus", () => {
  it("name corpus matches the shared verdicts", () => {
    for (const entry of NAME_CORPUS) {
      expect(isValidEventName(entry.name), entry.label).toBe(entry.valid);
    }
  });

  it("property corpus matches the shared verdicts", () => {
    for (const entry of PROPERTY_CORPUS) {
      const value = entry.runtime ?? entry.json;
      expect(validateJsonValue(value).ok, entry.label).toBe(entry.valid);
    }
  });

  it("depth parity on the core side", () => {
    expect(validateJsonValue(depthCase(12).json).ok).toBe(true);
    expect(validateJsonValue(depthCase(13).json).ok).toBe(false);
  });
});
