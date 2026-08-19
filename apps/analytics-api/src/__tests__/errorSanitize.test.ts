import { describe, expect, it } from "vitest";
import {
	REDACTED,
	redactAndBound,
	sanitizeErrorPayload,
	sanitizeFrame,
	sanitizeUrl,
} from "../utils/errorSanitize.js";

const opts = { maxDepth: 3, maxStringLength: 512 };

describe("redactAndBound", () => {
	it("redacts sensitive keys recursively", () => {
		const input = {
			password: "hunter2",
			apiKey: "psk_secret",
			Authorization: "Bearer abc",
			"session-id": "sess_1",
			email: "user@example.com",
			safe: { nested: { label: "ok" }, token: "t_123" },
		};
		const out = redactAndBound(input, opts) as Record<string, unknown>;
		expect(out.password).toBe(REDACTED);
		expect(out.apiKey).toBe(REDACTED);
		expect(out.Authorization).toBe(REDACTED);
		expect(out["session-id"]).toBe(REDACTED);
		expect(out.email).toBe(REDACTED);
		expect(out.safe).toEqual({ nested: { label: "ok" }, token: REDACTED });
	});

	it("bounds string lengths", () => {
		const out = redactAndBound(
			{ note: "x".repeat(1000) },
			{ maxDepth: 3, maxStringLength: 64 },
		) as Record<string, unknown>;
		expect(String(out.note)).toHaveLength(64);
	});

	it("degrades unknown shapes and deep structures", () => {
		expect(redactAndBound(() => 1, opts)).toBe(REDACTED);
		const deep = redactAndBound(
			{ a: { b: { c: { d: "x" } } } },
			{
				maxDepth: 2,
				maxStringLength: 512,
			},
		) as { a: { b: { c: unknown } } };
		expect(deep.a.b.c).toBe(REDACTED); // depth 3 exceeds the cap
	});

	it("redacts values inside arrays", () => {
		const out = redactAndBound(
			[{ secret: "s" }, "plain"],
			opts,
		) as Array<unknown>;
		expect(out[0]).toEqual({ secret: REDACTED });
		expect(out[1]).toBe("plain");
	});
});

describe("sanitizeUrl", () => {
	it("strips query, fragment and userinfo, keeping origin + path", () => {
		expect(
			sanitizeUrl("https://user:pass@app.example.com/a/b?token=abc#frag"),
		).toBe("https://app.example.com/a/b");
	});

	it("bounds malformed values instead of rejecting them", () => {
		const long = "x".repeat(5000);
		expect(sanitizeUrl(long)).toHaveLength(1024);
	});
});

describe("sanitizeFrame", () => {
	it("sanitizes the file URL and keeps numeric columns", () => {
		const frame = sanitizeFrame({
			file: "https://app.example.com/app.js?ver=1#x",
			function: "renderList",
			line: 203,
			column: 17,
			inApp: true,
		});
		expect(frame.file).toBe("https://app.example.com/app.js");
		expect(frame.function).toBe("renderList");
		expect(frame.line).toBe(203);
		expect(frame.column).toBe(17);
		expect(frame.inApp).toBe(true);
	});

	it("coerces junk fields to null", () => {
		const frame = sanitizeFrame({ file: 42, function: "x", line: "no" });
		expect(frame.file).toBe(null);
		expect(frame.line).toBe(null);
	});
});

describe("sanitizeErrorPayload", () => {
	const item = {
		exception: {
			type: "TypeError",
			message: "boom",
			frames: [
				{
					file: "https://app.example.com/app.js?ver=1",
					function: "f",
					line: 1,
					inApp: true,
				},
			],
		},
		handled: false,
		release: "web@1.0",
		environment: "production",
		context: { tags: { area: "checkout" }, extras: { apiKey: "psk_x" } },
		breadcrumbs: [{ timestamp: 1, type: "navigation", message: "go" }],
	};

	it("produces the title from type + message", () => {
		const out = sanitizeErrorPayload(item);
		expect(out.title).toBe("TypeError: boom");
	});

	it("derives location from the sanitized top frame", () => {
		const out = sanitizeErrorPayload(item);
		expect(out.location).toBe("https://app.example.com/app.js:1");
	});

	it("redacts context before persistence", () => {
		const out = sanitizeErrorPayload(item);
		const payload = JSON.parse(out.payload) as {
			context: {
				extras: Record<string, unknown>;
				tags: Record<string, unknown>;
			};
		};
		expect(payload.context.extras.apiKey).toBe(REDACTED);
		expect(payload.context.tags.area).toBe("checkout");
	});

	it("bounds the exception chain depth", () => {
		const deep = sanitizeErrorPayload({
			exception: {
				type: "A",
				cause: {
					type: "B",
					cause: {
						type: "C",
						cause: { type: "D", cause: { type: "E" } },
					},
				},
			},
			handled: true,
		});
		const payload = JSON.parse(deep.payload) as {
			exception: { cause?: unknown };
		};
		// depth 3 is the cap; deeper causes are dropped
		const second = payload.exception.cause as { cause?: unknown };
		const third = second.cause as { cause?: unknown };
		expect(third).toBeDefined();
		expect(third.cause).toBeUndefined();
	});

	it("uses the type alone when there is no message", () => {
		const out = sanitizeErrorPayload({
			exception: { type: "AbortError" },
			handled: true,
		});
		expect(out.title).toBe("AbortError");
	});
});
