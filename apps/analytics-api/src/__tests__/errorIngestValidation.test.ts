import { describe, expect, it } from "vitest";
import {
	parseErrorEnvelope,
	validateErrorItem,
} from "../utils/errorIngestValidation.js";

const validItem = {
	id: "evt_1",
	occurredAt: 1720000000000,
	level: "error",
	handled: false,
	exception: {
		type: "TypeError",
		message: "boom",
		frames: [
			{ file: "https://app.example.com/app.js", function: "f", line: 1 },
		],
	},
	release: "web@1.0",
	environment: "production",
	context: { tags: { area: "checkout" } },
	breadcrumbs: [
		{ timestamp: 1, type: "navigation", message: "go", level: "info" },
	],
};

const envelope = (errors: unknown[]) =>
	JSON.stringify({ schemaVersion: 1, sentAt: Date.now(), errors });

describe("parseErrorEnvelope", () => {
	it("accepts a valid v1 envelope", () => {
		const parsed = parseErrorEnvelope(envelope([validItem]));
		expect(parsed).toEqual({ ok: true, errors: [validItem], sdk: undefined });
	});

	it("rejects malformed JSON", () => {
		expect(parseErrorEnvelope("not json")).toEqual({
			ok: false,
			reason: "invalid-envelope",
		});
	});

	it("rejects unknown schema versions", () => {
		const parsed = parseErrorEnvelope(
			JSON.stringify({ schemaVersion: 2, errors: [] }),
		);
		expect(parsed).toEqual({ ok: false, reason: "unsupported-schema" });
	});

	it("rejects an oversized batch", () => {
		const tooMany = Array.from({ length: 51 }, () => validItem);
		expect(parseErrorEnvelope(envelope(tooMany))).toEqual({
			ok: false,
			reason: "invalid-envelope",
		});
	});
});

describe("validateErrorItem", () => {
	it("accepts a valid item", () => {
		const result = validateErrorItem(validItem);
		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.item.id).toBe("evt_1");
			expect(result.item.handled).toBe(false);
			expect(result.item.level).toBe("error");
			expect(result.item.exception.type).toBe("TypeError");
		}
	});

	it("defaults handled to false", () => {
		const { id, occurredAt, level, exception } = validItem;
		const result = validateErrorItem({ id, occurredAt, level, exception });
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.item.handled).toBe(false);
	});

	it("rejects a missing exception", () => {
		const { id, occurredAt, level } = validItem;
		const result = validateErrorItem({ id, occurredAt, level });
		expect(result).toEqual({ ok: false, reason: "invalid-exception" });
	});

	it("rejects a bad level", () => {
		const result = validateErrorItem({ ...validItem, level: "fatal" });
		expect(result).toEqual({ ok: false, reason: "invalid-level" });
	});

	it("rejects a non-finite timestamp", () => {
		const result = validateErrorItem({ ...validItem, occurredAt: "now" });
		expect(result).toEqual({ ok: false, reason: "invalid-timestamp" });
	});

	it("rejects a missing or oversized id", () => {
		expect(validateErrorItem({ ...validItem, id: "" })).toEqual({
			ok: false,
			reason: "invalid-id",
		});
		expect(validateErrorItem({ ...validItem, id: "x".repeat(200) })).toEqual({
			ok: false,
			reason: "invalid-id",
		});
	});

	it("rejects too many breadcrumbs", () => {
		const result = validateErrorItem({
			...validItem,
			breadcrumbs: Array.from({ length: 31 }, () => ({ message: "m" })),
		});
		expect(result).toEqual({ ok: false, reason: "invalid-breadcrumbs" });
	});

	it("rejects junk in context", () => {
		const result = validateErrorItem({ ...validItem, context: { tags: "no" } });
		expect(result).toEqual({ ok: false, reason: "invalid-context" });
	});

	it("rejects unknown top-level fields (strict schema)", () => {
		const result = validateErrorItem({ ...validItem, evil: "x" });
		expect(result.ok).toBe(false);
	});
});
