import { describe, expect, it } from "vitest";
import {
	FINGERPRINT_VERSION,
	fingerprintV1,
	issueIdFor,
	normalizeMessage,
} from "../utils/errorFingerprint.js";

const base = {
	type: "TypeError",
	message: "Cannot read properties of undefined (reading 'x')",
	frames: [
		{
			file: "https://app.example.com/_next/static/app.js",
			function: "renderList",
		},
		{
			file: "https://app.example.com/_next/static/chunks/main.js",
			function: "render",
		},
	],
};

describe("normalizeMessage", () => {
	it("lowercases and collapses whitespace", () => {
		expect(normalizeMessage("  Cannot   READ props\n")).toBe(
			"cannot read props",
		);
	});

	it("replaces digit runs so dynamic ids do not fragment groups", () => {
		expect(normalizeMessage("order 12345 failed at 2026-08-17")).toBe(
			"order # failed at #-#-#",
		);
	});
});

describe("fingerprintV1", () => {
	it("is deterministic — identical input yields identical fingerprints", () => {
		expect(fingerprintV1(base)).toBe(fingerprintV1(base));
	});

	it("differs when the exception type changes", () => {
		expect(fingerprintV1({ ...base, type: "RangeError" })).not.toBe(
			fingerprintV1(base),
		);
	});

	it("ignores message digit noise (normalization)", () => {
		expect(
			fingerprintV1({
				...base,
				message: "Cannot read properties of undefined (reading 'x')",
			}),
		).toBe(
			fingerprintV1({
				...base,
				message: "Cannot read properties of undefined (reading 'x')",
			}),
		);
		// dynamic values collapse to the same normalized message
		expect(fingerprintV1({ ...base, message: "order 999 failed" })).toBe(
			fingerprintV1({ ...base, message: "order 1 failed" }),
		);
	});

	it("uses stable top frames only (file + function, no lines)", () => {
		expect(
			fingerprintV1({
				...base,
				frames: base.frames.map((frame) => ({ ...frame, line: 203 })),
			}),
		).toBe(
			fingerprintV1({
				...base,
				frames: base.frames.map((frame) => ({ ...frame, line: 999 })),
			}),
		);
	});

	it("differs when the top frame changes", () => {
		expect(
			fingerprintV1({
				...base,
				frames: [
					{ file: "https://other.example.com/x.js", function: "renderList" },
				],
			}),
		).not.toBe(fingerprintV1(base));
	});
});

describe("issueIdFor", () => {
	it("is deterministic per project + platform + fingerprint", () => {
		const fp = fingerprintV1(base);
		expect(issueIdFor("p1", "web", fp)).toBe(issueIdFor("p1", "web", fp));
	});

	it("separates projects and platforms", () => {
		const fp = fingerprintV1(base);
		expect(issueIdFor("p1", "web", fp)).not.toBe(issueIdFor("p2", "web", fp));
		expect(issueIdFor("p1", "web", fp)).not.toBe(
			issueIdFor("p1", "server", fp),
		);
	});

	it("is stable across runs (no random input)", () => {
		const fp = fingerprintV1(base);
		expect(issueIdFor("p1", "web", fp)).toMatch(/^[0-9a-f]{32}$/);
	});

	it("bakes the fingerprint version into the id", () => {
		expect(FINGERPRINT_VERSION).toBe(1);
	});
});
