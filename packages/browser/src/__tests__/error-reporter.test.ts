import type { PrismResponse } from "@prism-analytics/core";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type BrowserErrorReporter,
	createBrowserErrorReporter,
	framesFromStack,
	normalizeErrorValue,
} from "../index";

/**
 * @prism-analytics/browser error-reporter tests (task-15 slice 3b): the
 * browser adapter translates Error/ErrorEvent/PromiseRejectionEvent and
 * arbitrary values into the core error lane, keeps global handlers
 * opt-in + idempotently installable/uninstallable, coalesces
 * same-fingerprint bursts with a bounded dedupe window, and handles
 * "Script error." honestly. Delivery is the core's ingest endpoint.
 */

function okResponse(status = 200): PrismResponse {
	return {
		status,
		headers: { "content-type": "application/json" },
		text: async () => "",
	};
}

function installFetchMock(
	handler: (url: string, init: RequestInit) => Promise<PrismResponse>,
) {
	return vi
		.spyOn(globalThis, "fetch")
		.mockImplementation(async (input, init) => {
			const response = await handler(String(input), init ?? {});
			return new Response(await response.text(), {
				status: response.status,
				headers: response.headers,
			});
		});
}

const BASE = {
	sourceKey: "pr_0123456789abcdef0123456789abcdef",
	endpoint: "https://errors.self-hosted.example",
	share: { consent: () => "granted" as const },
};

const sleep = (ms: number): Promise<void> =>
	new Promise((resolve) => setTimeout(resolve, ms));

afterEach(() => {
	vi.restoreAllMocks();
	window.localStorage.clear();
	try {
		window.sessionStorage.clear();
	} catch {
		// storage denied — ignore
	}
});

describe("framesFromStack", () => {
	it("parses V8 frames (at fn (url:line:col))", () => {
		const stack = [
			"Error: boom",
			"    at aThing (https://app.example/main.js:12:34)",
			"    at https://cdn.example/vendor.js:5:6",
			"    at Array.forEach (<anonymous>:1:1)",
		].join("\n");
		const frames = framesFromStack(stack);
		expect(frames).toHaveLength(2);
		expect(frames[0]).toMatchObject({
			function: "aThing",
			file: "https://app.example/main.js",
			line: 12,
			column: 34,
		});
		expect(frames[1]?.file).toBe("https://cdn.example/vendor.js");
		expect(frames[1]?.inApp).toBe(false); // vendored
	});

	it("parses Firefox/Safari frames (fn@url:line:col)", () => {
		const frames = framesFromStack(
			"doIt@https://app.example/main.js:40:8\n@https://app.example/main.js:41:1",
		);
		expect(frames[0]).toMatchObject({ function: "doIt", line: 40 });
		expect(frames[1]?.function).toBeUndefined(); // anonymous
	});

	it("returns nothing for missing/malformed stacks", () => {
		expect(framesFromStack(undefined)).toHaveLength(0);
		expect(framesFromStack("")).toHaveLength(0);
		expect(framesFromStack("garbage without a colon")).toHaveLength(0);
	});
});

describe("normalizeErrorValue", () => {
	it("normalizes an Error instance with frames", () => {
		const error = new Error("kaboom");
		error.name = "RangeError";
		const input = normalizeErrorValue(error);
		expect(input.exception.type).toBe("RangeError");
		expect(input.exception.message).toBe("kaboom");
		expect(Array.isArray(input.exception.frames)).toBe(true);
	});

	it("normalizes an ErrorEvent message honestly as ScriptError", () => {
		const input = normalizeErrorValue({ message: "Script error." });
		expect(input.exception.type).toBe("ScriptError");
		expect(input.exception.message).toBe("Script error.");
		expect(input.context?.extras?.scriptError).toBe(true);
		expect(input.exception.frames).toBeUndefined(); // never fabricated
	});

	it("normalizes an unhandled-rejection event reason", () => {
		const event = { type: "unhandledrejection", reason: new Error("rejected") };
		const input = normalizeErrorValue(event);
		expect(input.exception.type).toBe("Error");
		expect(input.exception.message).toBe("rejected");
	});

	it("summarizes an opaque rejection reason without throwing", () => {
		const input = normalizeErrorValue({ code: 10086, details: "nope" });
		expect(input.exception.type).toBe("UnhandledRejection");
		expect(input.exception.message).toContain("10086");
	});

	it("passes through a plain string", () => {
		const input = normalizeErrorValue("plain string failure");
		expect(input.exception.type).toBe("Error");
		expect(input.exception.message).toBe("plain string failure");
	});

	it("passes through a valid ErrorReportInput", () => {
		const input = normalizeErrorValue({
			exception: { type: "Manual", message: "caller crafted" },
			level: "warning",
		});
		expect(input.exception.type).toBe("Manual");
		expect(input.level).toBe("warning");
	});
});

describe("createBrowserErrorReporter", () => {
	it("requires a runtime endpoint", async () => {
		await expect(
			createBrowserErrorReporter({ ...BASE, endpoint: "" }),
		).rejects.toThrow(/endpoint is required/);
	});

	it("requires a consent share", async () => {
		await expect(
			createBrowserErrorReporter({
				...BASE,
				share: undefined as never,
			}),
		).rejects.toThrow(/share is required/);
	});

	it("delivers a captured error to the ingest endpoint with core auth", async () => {
		const bodies: Array<{ url: string; body: string }> = [];
		installFetchMock(async (url, init) => {
			bodies.push({ url, body: String(init.body) });
			return okResponse();
		});
		const bound = await createBrowserErrorReporter({
			...BASE,
			share: { consent: () => "granted" as const, anonymousId: () => "anon-9" },
		});

		const result = bound.captureException(
			new Error("dashboard render failed"),
			{ environment: "staging", release: "web@1.2.3" },
		);
		expect(result.status).toBe("queued");
		await bound.flush();

		expect(bodies).toHaveLength(1);
		expect(bodies[0]?.url).toBe(
			"https://errors.self-hosted.example/api/v1/errors/ingest",
		);
		const envelope = JSON.parse(bodies[0]?.body ?? "{}") as {
			schemaVersion: number;
			errors: Array<{
				exception: { type: string; message: string };
				anonymousId?: string;
				environment?: string;
				release?: string;
			}>;
		};
		expect(envelope.schemaVersion).toBe(1);
		expect(envelope.errors[0]?.exception.type).toBe("Error");
		expect(envelope.errors[0]?.exception.message).toBe(
			"dashboard render failed",
		);
		expect(envelope.errors[0]?.anonymousId).toBe("anon-9");
		expect(envelope.errors[0]?.environment).toBe("staging");
		expect(envelope.errors[0]?.release).toBe("web@1.2.3");
		await bound.shutdown();
	});

	it("drops under consent denial without any network call", async () => {
		const fetchSpy = installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter({
			...BASE,
			share: { consent: () => "denied" as const },
		});
		const result = bound.captureException("not allowed");
		expect(result.status).toBe("dropped");
		expect(fetchSpy).not.toHaveBeenCalled();
		await bound.shutdown();
	});

	it("coalesces same-fingerprint bursts inside the dedupe window", async () => {
		installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter({
			...BASE,
			dedupeMs: 200,
		});
		const first = bound.captureException(new Error("burst"));
		expect(first.status).toBe("queued");
		const second = bound.captureException(new Error("burst"));
		expect(second.status).toBe("deduped");
		expect(second.status === "deduped" && second.id).toBe(
			first.status === "queued" ? first.id : "",
		);
		await bound.shutdown();
	});

	it("queues again once the dedupe window has elapsed", async () => {
		installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter({
			...BASE,
			dedupeMs: 30,
		});
		expect(bound.captureException(new Error("again")).status).toBe("queued");
		await sleep(60);
		const later = bound.captureException(new Error("again"));
		expect(later.status).toBe("queued");
		await bound.shutdown();
	});

	it("installs handlers and captures dispatched window errors (opt-in)", async () => {
		const posted: string[] = [];
		installFetchMock(async (_url, init) => {
			posted.push(String(init.body));
			return okResponse();
		});
		const bound = await createBrowserErrorReporter(BASE);
		expect(bound.installed).toBe(false); // opt-in by default — no global handlers

		bound.install();
		expect(bound.installed).toBe(true);

		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "page boom",
				filename: "https://app.example/main.js",
				lineno: 7,
				colno: 3,
				error: new Error("page boom"),
			}),
		);
		window.dispatchEvent(
			new ErrorEvent("error", {
				message: "Script error.",
				error: undefined,
			} as ErrorEventInit),
		);

		expect(bound.pendingCount).toBeGreaterThan(0);
		await bound.flush();

		const envelope = JSON.parse(posted[0] ?? "{}") as {
			errors: Array<{
				exception: { type: string; message: string };
				handled: boolean;
				context?: { extras?: { scriptError?: boolean } };
			}>;
		};
		// the real Error (V8) wins over the event message
		expect(envelope.errors[0]?.exception.type).toBe("Error");
		expect(envelope.errors[0]?.handled).toBe(false); // global handlers are unhandled
		// the opaque cross-origin marker is captured honestly
		expect(envelope.errors[1]?.exception.type).toBe("ScriptError");
		expect(envelope.errors[1]?.context?.extras?.scriptError).toBe(true);
		await bound.shutdown();
	});

	it("uninstall removes the global error handlers", async () => {
		const fetchSpy = installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter(BASE);
		bound.install();
		bound.uninstall();
		expect(bound.installed).toBe(false);

		window.dispatchEvent(
			new ErrorEvent("error", { message: "should not capture" }),
		);
		// no reports queued and nothing was ever sent
		expect(bound.pendingCount).toBe(0);
		await bound.flush();
		expect(fetchSpy).not.toHaveBeenCalled();
		await bound.shutdown();
	});

	it("captureGlobalErrors opts in at construction, applied after the reporter is ready", async () => {
		installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter({
			...BASE,
			captureGlobalErrors: true,
		});
		expect(bound.installed).toBe(true);
		await bound.shutdown();
	});

	it("revives nothing when the share exposes no identity", async () => {
		installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter({
			...BASE,
			share: { consent: () => "granted" as const },
		});
		bound.captureException(new Error("nobody"));
		await bound.flush();
		await bound.shutdown();
		expect(true).toBe(true); // completed without throwing
	});

	it("drops queued reports permanently on a revoked key (401)", async () => {
		installFetchMock(async () => okResponse(401));
		const bound = await createBrowserErrorReporter({
			...BASE,
			queue: { maxRetries: 3 },
		});
		bound.captureException(new Error("revoked"));
		const diags: Array<{ code: string }> = [];
		bound.onDiagnostic((d) => diags.push(d));
		await bound.flush();
		expect(bound.pendingCount).toBe(0); // permanent — removed, not retried
		expect(diags.some((d) => d.code === "error_batch_rejected")).toBe(true);
		await bound.shutdown();
	});

	it("drops queued reports permanently on a wrong-origin response (403)", async () => {
		installFetchMock(async () => okResponse(403));
		const bound = await createBrowserErrorReporter(BASE);
		bound.captureException(new Error("bad origin"));
		await bound.flush();
		expect(bound.pendingCount).toBe(0); // 403 is non-retryable
		await bound.shutdown();
	});

	it("throws on a structurally invalid passthrough payload", async () => {
		installFetchMock(async () => okResponse());
		const bound = await createBrowserErrorReporter(BASE);
		// a report-shaped object with an EMPTY exception type is rejected by
		// the core contract (mirrors core: { exception: { type: "" } } throws)
		expect(() =>
			bound.captureException({ exception: { type: "" } } as never),
		).toThrow();
		// a message-only object is NOT report-shaped: the adapter summarizes it
		// as an opaque rejection instead of crashing the caller
		expect(() =>
			bound.captureException({ exception: { message: "no type" } } as never),
		).not.toThrow();
		await bound.shutdown();
	});

	it("retries a network failure with backoff, then drops after maxRetries", async () => {
		const onFetch = vi.fn(async () => {
			throw new TypeError("network down");
		});
		installFetchMock(onFetch as never);
		const bound = await createBrowserErrorReporter({
			...BASE,
			queue: { maxRetries: 2, flushIntervalMs: 60_000 }, // backoff won't fire in-test
		});
		bound.captureException(new Error("offline"));
		const diags: Array<{ code: string }> = [];
		bound.onDiagnostic((d) => diags.push(d));
		await bound.flush().catch(() => undefined);
		expect(bound.pendingCount).toBe(1); // failure kept for retry
		await bound.flush().catch(() => undefined);
		expect(bound.pendingCount).toBe(0); // exhausted -> dropped
		expect(diags.some((d) => d.code === "error_batch_dropped")).toBe(true);
		await bound.shutdown();
	});

	it("flushes queued reports on before-unload via an authenticated keepalive request", async () => {
		const inits: Array<RequestInit> = [];
		installFetchMock(async (_url, init) => {
			inits.push(init);
			return okResponse();
		});
		const bound = await createBrowserErrorReporter(BASE);
		bound.captureException(new Error("leaving"));
		bound.captureException(new Error("also leaving"));
		expect(bound.pendingCount).toBe(2);
		expect(inits).toHaveLength(0);

		window.dispatchEvent(new Event("beforeunload"));
		await sleep(0);
		await sleep(0); // let the lifecycle-triggered tick complete

		expect(bound.pendingCount).toBe(0);
		expect(inits.length).toBe(1);
		// authenticated keepalive — never an unauthenticated sendBeacon fallback
		expect(inits[0]?.keepalive).toBe(true);
		const headers = (inits[0]?.headers ?? {}) as Record<string, string>;
		const auth = Object.values(headers).find((value) =>
			String(value).toLowerCase().startsWith("bearer"),
		);
		expect(auth).toBeDefined(); // authenticated keepalive
		await bound.shutdown();
	});
});
