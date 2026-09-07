/**
 * Eval dataset contract tests (Task 21 slice 8, offline).
 *
 * The versioned release set must stay internally consistent without a
 * live model: every referenced metric/tool/artifact exists in the
 * frozen registries, adversarial entries expect unavailable or
 * definition states (never answered numbers), causal language is
 * absent from every caveat, and the known-inaccurate Mobile facts stay
 * pinned to `unavailable` until Task 18 R4-F3 lands.
 */
import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ARTIFACT_KINDS,
  METRIC_REGISTRY,
  TOOL_IDS,
  containsCausalClaim,
  type MetricId,
} from "@prism-analytics/types";
import dataset from "../../../../evals/assistant-eval-v1.json";

const BEHAVIORS = ["answer", "ask-definition", "unsupported"] as const;

describe("assistant eval v1 dataset", () => {
  it("is versioned with stable case IDs", () => {
    expect(dataset.evalVersion).toBe(1);
    const ids = (dataset.cases as Array<{ id: string } >).map((entry) => entry.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers every required question family", () => {
    const text = JSON.stringify(dataset).toLowerCase();
    for (const required of [
      "signup",
      "previous day",
      "30 days",
      "platform",
      "changed this week",
      "bounce rate",
      "android",
      "installations",
      "unresolved errors",
      "release",
      "usd",
      "revenue",
      "retention",
      "fake_admin_instruction",
      "previous week",
      "by source",
    ]) {
      expect(text, required).toContain(required);
    }
  });

  it("references only frozen tools, artifacts, and behaviors", () => {
    for (const entry of dataset.cases as Array<{
      id: string;
      expectedTools: string[];
      expectedArtifact: string;
      expectedBehavior: string;
    }>) {
      for (const tool of entry.expectedTools) {
        expect((TOOL_IDS as readonly string[]), entry.id).toContain(tool);
      }
      expect(
        (ASSISTANT_ARTIFACT_KINDS as readonly string[]),
        entry.id,
      ).toContain(entry.expectedArtifact);
      expect(BEHAVIORS as readonly string[], entry.id).toContain(
        entry.expectedBehavior,
      );
    }
  });

  it("keeps adversarial and missing-definition cases out of answered numbers", () => {
    const strict = (dataset.cases as Array<{
      id: string;
      family: string;
      expectedBehavior: string;
      expectedArtifact: string;
    }>).filter((entry) =>
      ["adversarial", "missing-definition", "unsupported-capability"].includes(
        entry.family,
      ),
    );
    expect(strict.length).toBeGreaterThan(0);
    for (const entry of strict) {
      expect(entry.expectedBehavior).not.toBe("answer");
      expect(entry.expectedArtifact).toBe("unavailable");
    }
  });

  it("pins known-inaccurate Mobile facts to unavailable", () => {
    const entry = (dataset.cases as Array<{ id: string; expectedArtifact: string }>).find(
      (item) => item.id === "observed-installations",
    );
    expect(entry?.expectedArtifact).toBe("unavailable");
  });

  it("contains no causal claims in expectations", () => {
    // Caveats describe allowed behavior, so they must never carry causal
    // language. `forbidden` entries may quote the banned phrasing to pin
    // the prohibition (checked separately below).
    for (const entry of dataset.cases as Array<{
      id: string;
      caveats: string[];
    }>) {
      for (const line of entry.caveats) {
        expect(containsCausalClaim(line), `${entry.id}: ${line}`).toBe(false);
      }
    }
    // The release case explicitly forbids the causal reading.
    const release = (dataset.cases as Array<{ id: string; forbidden: string[] }>).find(
      (item) => item.id === "errors-after-release",
    );
    expect(
      release?.forbidden.some((line) => line.toLowerCase().includes("caused")),
    ).toBe(true);
  });

  it("money cases forbid conversion and derived revenue metrics", () => {
    const money = (dataset.cases as Array<{ id: string; forbidden: string[] }>).find(
      (item) => item.id === "purchase-value-usd",
    );
    expect(money?.forbidden.join(" ").toLowerCase()).toContain("convert");
  });
});

describe("canonical metric IDs referenced by eval tooling", () => {
  it("resolves the core metric surface in the frozen registry", () => {
    for (const id of [
      "project.accepted_events",
      "project.sessions",
      "mobile.observed_installations",
      "errors.occurrences",
    ] as const) {
      expect(METRIC_REGISTRY[id satisfies MetricId]).toBeDefined();
    }
  });
});
