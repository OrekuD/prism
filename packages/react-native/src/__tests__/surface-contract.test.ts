import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * Export/declaration contract (R3-F6): the published surface must NOT
 * contain test-only helpers. Guards against regression of
 * resetReactNativeInstallForTests/__resetOwnerForTests leaking into dts.
 */
describe("react-native public surface contract", () => {
	it("generated declarations expose no test-only helpers", () => {
		const dts = readFileSync("dist/index.d.ts", "utf8");
		expect(dts).not.toMatch(/ForTests|__internal|__reset/);
	});

	it("built bundle contains no Math.random identity path", () => {
		// Comments are stripped in dist - this catches real usage.
		const dist = readFileSync("dist/index.js", "utf8");
		expect(dist).not.toContain("Math.random");
	});
});
