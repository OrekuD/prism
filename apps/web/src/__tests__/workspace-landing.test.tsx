import { describe, expect, it } from "vitest";
import { resolveWorkspaceLandingPath } from "@/components/workspace/workspace-scope";

describe("workspace landing", () => {
	const projects = [{ slug: "storefront" }, { slug: "admin" }];

	it("returns the remembered project when it still belongs to the workspace", () => {
		expect(resolveWorkspaceLandingPath("wrk_acme", projects, "admin")).toBe(
			"/workspace/wrk_acme/projects/admin",
		);
	});

	it("opens the only project directly", () => {
		expect(
			resolveWorkspaceLandingPath("wrk_acme", [{ slug: "storefront" }], null),
		).toBe("/workspace/wrk_acme/projects/storefront");
	});

	it("uses the project directory when no valid project can be selected", () => {
		expect(
			resolveWorkspaceLandingPath("wrk_acme", projects, "removed-project"),
		).toBe("/workspace/wrk_acme/projects");
		expect(resolveWorkspaceLandingPath("wrk_acme", [], null)).toBe(
			"/workspace/wrk_acme/projects",
		);
	});
});
