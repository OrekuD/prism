import { describe, expect, it } from "vitest";
import {
	checkAdapterCompatibility,
	checkClientKeyCompatibility,
	checkStoredKeyCompatibility,
	SOURCE_KEY_CLASS,
	SOURCE_KEY_PREFIX,
	adapterFamily,
	familyForPlatform,
	familyLabel,
	isSourceKeyFormat,
	parseSourceKey,
} from "../source-family";

const SUFFIX = "A".repeat(43);
const VALID = {
	web: `${SOURCE_KEY_PREFIX.web}${SUFFIX}`,
	mobile: `${SOURCE_KEY_PREFIX.mobile}${SUFFIX}`,
	server: `${SOURCE_KEY_PREFIX.server}${SUFFIX}`,
};

describe("source key format (task 29)", () => {
	it("parses each family with its derived key class", () => {
		expect(parseSourceKey(VALID.web)).toEqual({
			family: "web",
			keyClass: "publishable",
		});
		expect(parseSourceKey(VALID.mobile)).toEqual({
			family: "mobile",
			keyClass: "publishable",
		});
		expect(parseSourceKey(VALID.server)).toEqual({
			family: "server",
			keyClass: "secret",
		});
		expect(SOURCE_KEY_CLASS.server).toBe("secret");
	});

	it("rejects obsolete formats, bad suffixes, and non-strings", () => {
		expect(parseSourceKey("psk_0123456789abcdef")).toBeNull(); // pre-29 format
		expect(parseSourceKey(`psk_web_${"A".repeat(42)}`)).toBeNull(); // short
		expect(parseSourceKey(`psk_web_${"A".repeat(44)}`)).toBeNull(); // long
		expect(parseSourceKey(`psk_web_${"!".repeat(43)}`)).toBeNull(); // charset
		expect(parseSourceKey(`ssk_${SUFFIX}extra`)).toBeNull();
		expect(parseSourceKey(null)).toBeNull();
		expect(parseSourceKey(42)).toBeNull();
		expect(isSourceKeyFormat(VALID.web)).toBe(true);
		expect(isSourceKeyFormat("pr_abc")).toBe(false);
	});

	it("maps canonical and legacy platforms to families", () => {
		expect(familyForPlatform("web")).toBe("web");
		expect(familyForPlatform("mobile")).toBe("mobile");
		expect(familyForPlatform("react-native")).toBe("mobile");
		expect(familyForPlatform("ios")).toBe("mobile");
		expect(familyForPlatform("android")).toBe("mobile");
		expect(familyForPlatform("server")).toBe("server");
		expect(familyForPlatform("kiosk")).toBeNull();
		expect(familyLabel("mobile")).toBe("Mobile");
	});
});

describe("adapter registry (task 29)", () => {
	it("resolves supported adapters per family", () => {
		expect(adapterFamily("@prism-analytics/browser")).toBe("web");
		expect(adapterFamily("@prism-analytics/react")).toBe("web");
		expect(adapterFamily("@prism-analytics/react-native")).toBe("mobile");
		expect(adapterFamily("@prism-analytics/node")).toBe("server");
		expect(adapterFamily("manual")).toBe("server");
		expect(adapterFamily("@prism-analytics/core")).toBeNull();
		expect(adapterFamily("unknown-sdk")).toBeNull();
	});
});

describe("client key checks (task 29)", () => {
	const adapter = {
		adapterName: "@prism-analytics/browser",
		adapterFamily: "web" as const,
	};

	it("accepts a matching family", () => {
		expect(
			checkClientKeyCompatibility({ sourceKey: VALID.web, ...adapter })
		).toEqual({ ok: true, family: "web" });
	});

	it("gives the exact cross-family guidance without echoing the key", () => {
		const result = checkClientKeyCompatibility({
			sourceKey: VALID.mobile,
			...adapter,
		});
		expect(result).toEqual({
			ok: false,
			code: "incompatible-source",
			message: "This key belongs to a Mobile source. Use a Web source key.",
		});
		expect(JSON.stringify(result)).not.toContain(SUFFIX);
	});

	it("rejects secret server keys in client adapters", () => {
		const result = checkClientKeyCompatibility({
			sourceKey: VALID.server,
			...adapter,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("secret-key-in-client");
			expect(result.message).toContain("never be embedded");
		}
	});

	it("rejects obsolete formats with a recoverable message", () => {
		const result = checkClientKeyCompatibility({
			sourceKey: "psk_oldformat",
			...adapter,
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("obsolete-key-format");
	});
});

describe("server key checks (task 29)", () => {
	it("accepts a stored key matching its source family", () => {
		expect(
			checkStoredKeyCompatibility({
				key: VALID.server,
				storedFamily: "server",
			})
		).toEqual({ ok: true, family: "server" });
	});

	it("flags a stored mismatch as a configuration fault", () => {
		const result = checkStoredKeyCompatibility({
			key: VALID.web,
			storedFamily: "mobile",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.code).toBe("key-source-mismatch");
			expect(result.message).toContain("Regenerate");
		}
	});

	it("flags obsolete stored keys", () => {
		const result = checkStoredKeyCompatibility({
			key: "ssk_deadbeef",
			storedFamily: "server",
		});
		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.code).toBe("obsolete-key-format");
	});
});

describe("batch adapter checks (task 29)", () => {
	it("accepts a declared adapter for its family", () => {
		expect(
			checkAdapterCompatibility("@prism-analytics/react-native", "mobile")
		).toEqual({ ok: true, family: "mobile" });
		expect(checkAdapterCompatibility("manual", "server")).toEqual({
			ok: true,
			family: "server",
		});
	});

	it("rejects missing, unknown, and mismatched declarations", () => {
		const missing = checkAdapterCompatibility(undefined, "web");
		expect(missing.ok).toBe(false);
		if (!missing.ok) expect(missing.code).toBe("unsupported-adapter");

		const unknown = checkAdapterCompatibility("mystery-sdk", "web");
		expect(unknown.ok).toBe(false);
		if (!unknown.ok) expect(unknown.code).toBe("unsupported-adapter");

		const mismatch = checkAdapterCompatibility(
			"@prism-analytics/browser",
			"mobile"
		);
		expect(mismatch.ok).toBe(false);
		if (!mismatch.ok) expect(mismatch.code).toBe("incompatible-source");
	});
});
