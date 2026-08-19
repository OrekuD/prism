import { describe, expect, it } from "vitest";
import type { ErrorReportInput } from "../error-contract";
import {
	attachSharedContext,
	normalizeErrorReport,
	toWireErrorItem,
} from "../error-validation";

const valid: ErrorReportInput = {
	exception: {
		type: "TypeError",
		message: "boom",
		frames: [
			{ file: "https://app.example/app.js", function: "renderList", line: 40 },
		],
	},
	level: "error",
	handled: false,
	context: { tags: { area: "checkout" }, extras: { retry: 3 } },
	breadcrumbs: [{ message: "clicked pay", level: "info" }],
};

describe("normalizeErrorReport", () => {
	it("normalizes a valid report with deterministic id + timestamp", () => {
		const report = normalizeErrorReport(valid, "evt_1", 1720000000000);
		expect(report.id).toBe("evt_1");
		expect(report.occurredAt).toBe(1720000000000);
		expect(report.level).toBe("error");
		expect(report.handled).toBe(false);
		expect(report.exception.frames?.[0]?.line).toBe(40);
		expect(report.context?.tags?.area).toBe("checkout");
	});

	it("throws on structurally invalid caller input", () => {
		expect(() =>
			normalizeErrorReport({ exception: { type: "" } }, "1", 1),
		).toThrow();
		// TypeScript is not a trust boundary — the validator defends against
		// runtime-shaped garbage (established via never-pinned literals).
		expect(() =>
			normalizeErrorReport(
				{ exception: { type: "X" }, context: { extras: "no" } } as never,
				"1",
				1,
			),
		).toThrow();
		expect(() =>
			normalizeErrorReport(
				{ exception: { type: "X" }, breadcrumbs: "no" } as never,
				"1",
				1,
			),
		).toThrow();
		expect(() => normalizeErrorReport(null as never, "1", 1)).toThrow();
		expect(() => normalizeErrorReport(undefined as never, "1", 1)).toThrow();
		// dangerous keys are rejected, not silently merged
		expect(() =>
			normalizeErrorReport(
				{
					exception: { type: "X" },
					context: { extras: { ["__proto__"]: "x" } },
				} as never,
				"1",
				1,
			),
		).toThrow();
	});

	it("caps cosmetic overruns instead of throwing", () => {
		const longMessage = "x".repeat(10_000);
		const frames = Array.from({ length: 100 }, (_, i) => ({
			file: `https://app/app.js:${i}`,
			function: `f${i}`,
		}));
		const report = normalizeErrorReport(
			{ exception: { type: "T", message: longMessage, frames } },
			"1",
			1,
		);
		expect(report.exception.message?.length).toBeLessThanOrEqual(512);
		expect(report.exception.frames?.length).toBeLessThanOrEqual(32);
		expect(report.exception.type).toHaveLength(1);
	});

	it("bounds the cause chain, preserving deeper causes as opaque JSON", () => {
		// Deep has an INVALID type (5): if the recursion passed the ceiling it
		// would throw while trying to normalize it. It does not — the boundary
		// is enforced and the raw value is preserved as opaque JSON.
		const report = normalizeErrorReport(
			{
				exception: {
					type: "Outer",
					cause: {
						type: "Inner",
						cause: { type: "Mid", cause: { type: 5 } },
					},
				},
			},
			"1",
			1,
		);
		const inner = report.exception.cause as { type?: string; cause?: unknown };
		expect(inner.type).toBe("Inner");
		const mid = inner.cause as { type?: string; cause?: unknown };
		expect(mid.type).toBe("Mid");
		// depth-4 cause stopped the recursion: preserved raw, not normalized.
		expect(mid.cause).toBeDefined();
	});

	it("redacts credential-looking extras keys", () => {
		const report = normalizeErrorReport(
			{
				exception: { type: "X" },
				context: { extras: { password: "hunter2", token: "abc", ok: 1 } },
			},
			"1",
			1,
		);
		expect(report.context?.extras?.password).toBe("[REDACTED]");
		expect(report.context?.extras?.token).toBe("[REDACTED]");
		expect(report.context?.extras?.ok).toBe(1);
	});

	it("round-trips required fields into the frozen wire shape", () => {
		const report = normalizeErrorReport(valid, "evt_1", 1720000000000);
		const item = toWireErrorItem(report);
		expect(item).toMatchObject({
			id: "evt_1",
			occurredAt: 1720000000000,
			level: "error",
			handled: false,
			exception: { type: "TypeError" },
			context: { tags: { area: "checkout" } },
		});
		// defaults: session/anonymous/user ids are absent (never fabricated)
		expect(item.anonymousId).toBeUndefined();
		expect(JSON.parse(JSON.stringify(item))).toEqual(item);
	});
});

describe("attachSharedContext", () => {
	const base = normalizeErrorReport(valid, "e", 1);

	it("attaches sanctioned ids + sanitized globals when supplied", () => {
		const report = attachSharedContext(
			base,
			{
				anonymousId: "anon-42",
				sessionId: "sess-7",
				userId: null,
				globalProperties: { plan: "pro", password: "secret" },
			},
			12,
		);
		expect(report.anonymousId).toBe("anon-42");
		expect(report.sessionId).toBe("sess-7");
		expect(report.userId).toBeUndefined();
		// globals merge into context.extras, sanitized with the same policy
		expect(report.context?.extras?.plan).toBe("pro");
		expect(report.context?.extras?.password).not.toBe("secret");
	});

	it("never attaches ids on a non-granted path (caller controls consent)", () => {
		const report = attachSharedContext(
			base,
			{ anonymousId: null, globalProperties: undefined },
			12,
		);
		expect(report.anonymousId).toBeUndefined();
		// no globals merged into the report's existing extras
		expect(
			(report.context?.extras as Record<string, unknown>)?.plan,
		).toBeUndefined();
	});
});
