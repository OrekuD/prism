import { describe, expect, it } from "vitest";

import {
	getVisiblePresentationLayers,
	parseErrorPresentationStack,
} from "@/lib/presentationStack";

const basePath = "/workspace/acme/projects/storefront/errors";

describe("URL-backed error presentation stack", () => {
	it("creates the issue as the first sheet and occurrences as ordered children", () => {
		const parsed = parseErrorPresentationStack(
			basePath,
			"issue-a/occurrences/occ-a/occurrences/occ-b",
		);

		expect(parsed.valid).toBe(true);
		expect(parsed.layers).toEqual([
			{
				key: "issue:issue-a",
				kind: "issue",
				resourceId: "issue-a",
				path: `${basePath}/issue-a`,
				parentPath: basePath,
			},
			{
				key: "occurrence:0:occ-a",
				kind: "occurrence",
				resourceId: "occ-a",
				path: `${basePath}/issue-a/occurrences/occ-a`,
				parentPath: `${basePath}/issue-a`,
			},
			{
				key: "occurrence:1:occ-b",
				kind: "occurrence",
				resourceId: "occ-b",
				path: `${basePath}/issue-a/occurrences/occ-a/occurrences/occ-b`,
				parentPath: `${basePath}/issue-a/occurrences/occ-a`,
			},
		]);
	});

	it("renders only the newest three sheets and assigns cumulative visual depth", () => {
		const parsed = parseErrorPresentationStack(
			basePath,
			"issue-a/occurrences/occ-a/occurrences/occ-b/occurrences/occ-c/occurrences/occ-d",
		);
		const visible = getVisiblePresentationLayers(parsed.layers);

		expect(parsed.layers).toHaveLength(5);
		expect(visible).toHaveLength(3);
		expect(
			visible.map(({ layer, depth, isTop }) => ({
				key: layer.key,
				depth,
				isTop,
			})),
		).toEqual([
			{ key: "occurrence:1:occ-b", depth: 2, isTop: false },
			{ key: "occurrence:2:occ-c", depth: 1, isTop: false },
			{ key: "occurrence:3:occ-d", depth: 0, isTop: true },
		]);
	});

	it("marks malformed recursive routes invalid instead of inventing stack levels", () => {
		expect(
			parseErrorPresentationStack(basePath, "issue-a/not-occurrences/occ-a"),
		).toEqual({ valid: false, layers: [] });
		expect(
			parseErrorPresentationStack(basePath, "issue-a/occurrences"),
		).toEqual({ valid: false, layers: [] });
	});

	it("returns an empty valid stack for the errors index", () => {
		expect(parseErrorPresentationStack(basePath, "")).toEqual({
			valid: true,
			layers: [],
		});
	});
});
