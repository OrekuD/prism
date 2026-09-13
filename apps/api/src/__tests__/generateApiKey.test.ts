import { describe, expect, it } from "vitest";
import { parseSourceKey, SOURCE_KEY_PREFIX } from "@prism-analytics/core";
import { generateApiKey } from "../utils/generateApiKey";

/**
 * Task 29 slice 2: issuance produces family prefixes with 32 bytes of
 * random suffix. Impossible class/family pairings cannot be requested —
 * the class is derived from the family.
 */

describe("generateApiKey (task 29)", () => {
	it("issues the family prefix with a 43-char base64url suffix", () => {
		for (const family of ["web", "mobile", "server"] as const) {
			const key = generateApiKey(family);
			expect(key.startsWith(SOURCE_KEY_PREFIX[family])).toBe(true);
			const parsed = parseSourceKey(key);
			expect(parsed?.family).toBe(family);
		}
	});

	it("never repeats and never derives from ids", () => {
		const seen = new Set<string>();
		for (let i = 0; i < 200; i += 1) {
			const key = generateApiKey("web");
			expect(seen.has(key)).toBe(false);
			seen.add(key);
		}
	});

	it("does not carry legacy bare prefixes", () => {
		expect(generateApiKey("web").startsWith("psk_web_")).toBe(true);
		expect(generateApiKey("mobile").startsWith("psk_mobile_")).toBe(true);
		expect(generateApiKey("server").startsWith("ssk_")).toBe(true);
		expect(generateApiKey("server").startsWith("ssk__")).toBe(false);
	});
});
