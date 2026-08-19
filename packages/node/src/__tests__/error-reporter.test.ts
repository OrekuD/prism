import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createNodeErrorReporter,
	normalizeNodeErrorValue,
	reportError,
	type NodeErrorReporter,
} from "../index";
import type { PrismResponse } from "@prism-analytics/core";

/**
 * @prism-analytics/node error-reporter tests (task-15 Phase 4): the server
 * adapter normalizes Error/string/unknown values into the core error lane,
 * keeps process-level handlers OFF by default (opt-in only), enforces the
 * consent gate before delivery, stamps release/environment consistently,
 * keeps request context explicit (never ambient), and owns its
 * flush/shutdown contract.
 */

function okResponse(status = 200): PrismResponse {
	return {
		status,
		headers: Object.fromEntries(new Headers({ "content-type": "application/json" }).entries()),
		text: async () => "",
	};
}

function installFetchMock(
	handler: (url: string, init: RequestInit) => Promise<PrismResponse>,
) {
	return vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
		const url = typeof input === "string" ? input : (input as Request).url;
		const response = await handler(url, init ?? {});
		return new Response(await response.text(), {
			status: response.status,
			headers: response.headers,
		});
	});
}

let consent: "granted" | "denied" = "granted";
async function makeReporter(
	extra?: Partial<Parameters<typeof createNodeErrorReporter>[0]>,
): Promise<NodeErrorReporter> {
	return createNodeErrorReporter({
		sourceKey: "pr_0123456789abcdef0123456789abcdef",
		endpoint: "https://errors.self-hosted.example",
		share: { consent: () => consent },
		signals: [], // tests never want real signal/exit coupling
		...extra,
	});
}

afterEach(() => {
	vi.restoreAllMocks();
	consent = "granted";
});

describe("createNodeErrorReporter", () => {
	it("normalizes Error, string, and unknown values with handled=false default", async () => {
		installFetchMock(async () => okResponse());
		const reporter = await makeReporter();
		expect(reporter.captureException(new Error("boom")).status).toBe("queued");
		expect(reporter.captureException("string boom").status).toBe("queued");
		expect(reporter.captureException({ some: "object" }).status).toBe("queued");
		await reporter.flush();
		expect(reporter.pendingCount).toBe(0);
		await reporter.shutdown();
	});

	it("normalizeNodeErrorValue extracts frames from an Error stack", () => {
		const value = normalizeNodeErrorValue(new Error("boom"));
		expect(value.exception.type).toBe("Error");
		expect(value.exception.message).toBe("boom");
		expect(Array.isArray(value.exception.frames)).toBe(true);
	});

	it("does NOT attach process error handlers by default", async () => {
		// baseline: the test runner itself may install process handlers
		const baseUncaught = process.listenerCount("uncaughtException");
		const baseUnhandled = process.listenerCount("unhandledRejection");
		const reporter = await makeReporter();
		// captureProcessErrors never called -> reporter added no listeners
		expect(process.listenerCount("uncaughtException")).toBe(baseUncaught);
		expect(process.listenerCount("unhandledRejection")).toBe(baseUnhandled);
		await reporter.shutdown();
	});

	it("captureProcessErrors is explicit opt-in and returns an uninstall handle", async () => {
		const baseUncaught = process.listenerCount("uncaughtException");
		const baseUnhandled = process.listenerCount("unhandledRejection");
		const reporter = await makeReporter();
		const uninstall = reporter.captureProcessErrors();
		expect(process.listenerCount("uncaughtException")).toBe(baseUncaught + 1);
		expect(process.listenerCount("unhandledRejection")).toBe(baseUnhandled + 1);
		uninstall();
		expect(process.listenerCount("uncaughtException")).toBe(baseUncaught);
		expect(process.listenerCount("unhandledRejection")).toBe(baseUnhandled);
		await reporter.shutdown();
	});

	it("respects the consent gate: denied drops without a delivery attempt", async () => {
		const spy = installFetchMock(async () => okResponse());
		consent = "denied";
		const reporter = await makeReporter();
		expect(reporter.captureException(new Error("boom")).status).toBe("dropped");
		await reporter.flush();
		expect(spy).not.toHaveBeenCalled();
		await reporter.shutdown();
	});

	it("stamps release + environment consistently and posts them on the wire", async () => {
		const sent: { errors?: Array<Record<string, unknown>> } = {};
		installFetchMock(async (url, init) => {
			sent.errors = (JSON.parse(String(init.body)) as { errors: Array<Record<string, unknown>> })
				.errors;
			return okResponse();
		});
		const reporter = await makeReporter({
			release: "server@1.2.3",
			environment: "production",
		});
		reporter.captureException(new Error("boom"), {
			release: "server@3.0.0",
			context: { tags: { route: "/api/x", method: "POST" } },
		});
		await reporter.flush();
		expect(sent.errors?.[0]?.release).toBe("server@3.0.0");
		expect(sent.errors?.[0]?.environment).toBe("production");
		expect(
			(sent.errors?.[0]?.context as { tags?: Record<string, unknown> } | undefined)
				?.tags,
		).toEqual({ route: "/api/x", method: "POST" });
		await reporter.shutdown();
	});

	it("shutdown drains the queue then a later flush adds nothing", async () => {
		installFetchMock(async () => okResponse());
		const reporter = await makeReporter();
		reporter.captureException(new Error("boom"), { handled: true });
		await reporter.shutdown();
		expect(reporter.pendingCount).toBe(0);
		const after = await reporter.captureException(new Error("late"));
		expect(after.status).toBe("dropped");
		await reporter.flush();
	});

	it("reportError returns a non-throwing captured result for framework error handlers", async () => {
		installFetchMock(async () => okResponse());
		const reporter = await makeReporter();
		const result = reportError(reporter, new Error("handler boom"), {
			handled: false,
			context: { tags: { route: "/api" } },
		});
		expect(result.captured).toBe(true);
		expect(result.error).toBeInstanceOf(Error);
		await reporter.shutdown();
	});
});
