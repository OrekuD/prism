import { describe, expect, it } from "vitest";
import { comparisonLabel } from "@/routes/projects/project/mobile-analytics";

/**
 * Mobile comparison label (R10-F5): the shared `compareValues` returns
 * signed percentages, so the arrow carries direction and the label renders
 * the magnitude — matching the Web DeltaBadge (`Math.abs`). A decrease
 * must never render as `▼ -50%`.
 */
describe("mobile comparison label (R10-F5)", () => {
	it("renders up with magnitude", () => {
		expect(
			comparisonLabel({ kind: "percent", direction: "up", percent: 10 }),
		).toBe("▲ 10% vs previous");
	});

	it("renders down with magnitude, never a double sign", () => {
		expect(
			comparisonLabel({ kind: "percent", direction: "down", percent: -50 }),
		).toBe("▼ 50% vs previous");
		expect(
			comparisonLabel({ kind: "percent", direction: "down", percent: -50 }),
		).not.toContain("-50");
	});

	it("renders flat without an arrow", () => {
		expect(
			comparisonLabel({ kind: "percent", direction: "flat", percent: 0 }),
		).toBe("0% vs previous");
	});

	it("renders new and no-prior-data", () => {
		expect(comparisonLabel({ kind: "new" })).toBe("new");
		expect(comparisonLabel({ kind: "no-prior-data" })).toBe("no prior data");
	});
});
