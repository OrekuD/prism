import { describe, expect, it } from "vitest";
import { overviewQueryKey } from "@/network/queries/useProjectOverviewQuery";

describe("project overview query key (slice 3)", () => {
  it("is stable on project + range key without moving timestamps", () => {
    const first = overviewQueryKey({ slug: "alpha", range: "7d" });
    const second = overviewQueryKey({ slug: "alpha", range: "7d" });
    expect(first).toEqual(second);
    expect(first).toEqual([
      "workspace-project-overview",
      "alpha",
      "7d",
      null,
    ]);
    // No exact timestamps in the key.
    for (const part of first) {
      expect(typeof part === "number" && part > 1_000_000_000).toBe(false);
    }
  });

  it("separates ranges and projects", () => {
    expect(overviewQueryKey({ slug: "alpha", range: "7d" })).not.toEqual(
      overviewQueryKey({ slug: "alpha", range: "30d" }),
    );
    expect(overviewQueryKey({ slug: "alpha", range: "7d" })).not.toEqual(
      overviewQueryKey({ slug: "beta", range: "7d" }),
    );
  });
});
