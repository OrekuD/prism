import { afterEach, describe, expect, it, vi } from "vitest";
import {
	type ErrorReport,
	type PrismResponse,
	type PrismRuntimeAdapter,
	createPrismErrorReporter,
} from "../index";
import { base, fakeRuntime } from "./helpers";

function transportMock(
	handler: (
		url: string,
		body: string,
	) => PrismResponse | Promise<PrismResponse>,
) {
	const post = vi.fn(async (url: string, request: { body: string }) =>
		handler(url, request.body),
	);
	return { post, instance: post };
}

function runtimeWith(post: ReturnType<typeof vi.fn>): PrismRuntimeAdapter {
	const runtime = fakeRuntime("node-fake");
	return {
		...runtime,
		transport: { post: post as never },
	};
}

const shareFor = (consent: "pending" | "granted" | "denied" = "granted") => ({
	consent: () => consent,
	anonymousId: () => "anon-42",
	sessionId: () => "sess-7",
	userId: () => null,
	globalProperties: () => ({ plan: "pro", password: "secret" }),
});

const validInput = {
	exception: {
		type: "TypeError",
		message: "boom",
		frames: [
			{ file: "https://app.example/app.js", function: "renderList", line: 40 },
		],
	},
	release: "web@1.0",
	environment: "production",
};

async function makeReporter(
	opts: {
		consent?: "pending" | "granted" | "denied";
		share?: unknown;
		beforeSend?: (
			report: ErrorReport,
		) =>
			| { kind: "send"; report: ErrorReport }
			| { kind: "drop"; reason: string };
		transport?: ReturnType<typeof vi.fn>;
		queue?: Record<string, number>;
	} = {},
) {
	const post =
		opts.transport ??
		transportMock(() => ({ status: 200, headers: {}, text: async () => "" }))
			.post;
	return {
		reporter: await createPrismErrorReporter({
			sourceKey: base.sourceKey,
			endpoint: base.endpoint,
			runtime: runtimeWith(post),
			share: (opts.share as never) ?? shareFor(opts.consent),
			beforeSend: opts.beforeSend as never,
			queue: opts.queue,
		}),
		post,
	};
}

describe("createPrismErrorReporter", () => {
	afterEach(() => {
		vi.clearAllMocks();
	});

	it("throws during construction on invalid configuration", async () => {
		await expect(
			createPrismErrorReporter({
				sourceKey: "",
				endpoint: base.endpoint,
				runtime: fakeRuntime(),
				share: shareFor(),
			}),
		).rejects.toThrow();
	});

	it("requires a share source with a consent() function", async () => {
		await expect(
			createPrismErrorReporter({
				sourceKey: base.sourceKey,
				endpoint: base.endpoint,
				runtime: fakeRuntime(),
				share: {} as never,
			}),
		).rejects.toThrow();
	});

	it("drops under consent denial/pending before any work", async () => {
		const denied = await makeReporter({ consent: "denied" });
		expect(denied.reporter.captureException(validInput)).toEqual({
			status: "dropped",
			reason: "consent-denied",
		});
		expect(denied.reporter.pendingCount).toBe(0);

		const pending = await makeReporter({ consent: "pending" });
		expect(pending.reporter.captureException(validInput)).toEqual({
			status: "dropped",
			reason: "consent-pending",
		});
		expect(pending.reporter.pendingCount).toBe(0);
	});

	it("treats a throwing consent source as denied (never silently collects)", async () => {
		const { reporter } = await makeReporter({
			share: {
				consent: () => {
					throw new Error("broken");
				},
			},
		});
		const result = reporter.captureException(validInput) as { reason: string };
		expect(result.reason).toBe("consent-denied");
	});

	it("throws on structurally invalid caller input", async () => {
		const { reporter } = await makeReporter();
		expect(() =>
			reporter.captureException({ exception: { type: "" } }),
		).toThrow();
		expect(() =>
			reporter.captureException({ exception: "no" } as never),
		).toThrow();
	});

	it("queues and flushes to the frozen traffic-shape endpoint", async () => {
		const { reporter, post } = await makeReporter();
		const queued = reporter.captureException(validInput) as {
			status: string;
			id: string;
		};
		expect(queued.status).toBe("queued");
		expect(reporter.pendingCount).toBe(1);

		await reporter.flush();
		expect(reporter.pendingCount).toBe(0);
		const [url, request] = post.mock.calls[0] as [
			string,
			{ body: string; headers: Record<string, string> },
		];
		expect(url).toBe(`${base.endpoint}/api/v1/errors/ingest`);
		expect(request.headers.authorization).toBe(`Bearer ${base.sourceKey}`);
		const body = JSON.parse(request.body) as {
			schemaVersion: number;
			errors: Array<{
				id: string;
				anonymousId: string;
				sessionId: string;
				context?: { extras?: Record<string, unknown> };
			}>;
		};
		expect(body.schemaVersion).toBe(1);
		expect(body.errors[0]?.id).toBe(queued.id);
		expect(body.errors[0]?.anonymousId).toBe("anon-42");
		// session/user ids are REPORT-level only (available to beforeSend);
		// the frozen ingest wire carries just anonymousId — a strict server.
		expect(body.errors[0]?.sessionId).toBeUndefined();
		// globals merge into context.extras, sanitized: plan survives, the
		// credential key is redacted
		expect(
			(body.errors[0]?.context?.extras as { plan?: string } | undefined)?.plan,
		).toBe("pro");
		expect(
			(body.errors[0]?.context?.extras as Record<string, unknown> | undefined)
				?.password,
		).not.toBe("secret");
	});

	it("attaches NO shared identity when the share exposes none", async () => {
		const { reporter, post } = await makeReporter({
			share: { consent: () => "granted" },
		});
		reporter.captureException(validInput);
		await reporter.flush();
		const [, request] = post.mock.calls[0] as [string, { body: string }];
		const body = JSON.parse(request.body) as {
			errors: Array<Record<string, unknown>>;
		};
		expect(body.errors[0]?.anonymousId).toBeUndefined();
		expect(body.errors[0]?.sessionId).toBeUndefined();
	});

	it("honors beforeSend: drop, redact, and throw-with-original", async () => {
		const dropped = await makeReporter({
			beforeSend: () => ({ kind: "drop", reason: "noise" }),
		});
		const result = dropped.reporter.captureException(validInput) as {
			reason: string;
		};
		expect(result.reason).toBe("invalid-report");
		expect(dropped.reporter.pendingCount).toBe(0);

		const redacted = await makeReporter({
			beforeSend: (report) => ({
				kind: "send",
				report: {
					...report,
					exception: { ...report.exception, message: "[redacted]" },
				},
			}),
		});
		redacted.reporter.captureException(validInput);
		await redacted.reporter.flush();
		const [, request] = redacted.post.mock.calls[0] as [
			string,
			{ body: string },
		];
		const body = JSON.parse(request.body) as {
			errors: Array<{ exception: { message: string } }>;
		};
		expect(body.errors[0]?.exception.message).toBe("[redacted]");

		// a throwing beforeSend sends the ORIGINAL report (capture never crashes)
		const throwing = await makeReporter({
			beforeSend: () => {
				throw new Error("hook bug");
			},
		});
		const diags: Array<{ code: string }> = [];
		throwing.reporter.onDiagnostic((d) => diags.push(d));
		expect(throwing.reporter.captureException(validInput).status).toBe(
			"queued",
		);
		await throwing.reporter.flush();
		expect(diags.some((d) => d.code === "before_send_error")).toBe(true);
	});

	it("drops when the error queue is full", async () => {
		const { reporter } = await makeReporter({ queue: { maxQueueErrors: 1 } });
		expect(reporter.captureException(validInput).status).toBe("queued");
		expect(reporter.captureException(validInput)).toEqual({
			status: "dropped",
			reason: "queue-full",
		});
	});

	it("classifies retryable vs permanent failures", async () => {
		// 500 → retry (batch kept), then with maxRetries 1 the next failure drops it.
		const failing = transportMock(() => ({
			status: 500,
			headers: {},
			text: async () => "",
		}));
		const retrying = await makeReporter({
			transport: failing.post,
			queue: { maxRetries: 2 },
		});
		retrying.reporter.captureException(validInput);
		const diags: Array<{ code: string }> = [];
		retrying.reporter.onDiagnostic((d) => diags.push(d));
		await retrying.reporter.flush().catch(() => undefined);
		expect(retrying.reporter.pendingCount).toBe(1); // kept for retry
		await retrying.reporter.flush().catch(() => undefined);
		expect(retrying.reporter.pendingCount).toBe(0); // exhausted → dropped
		expect(diags.some((d) => d.code === "error_batch_dropped")).toBe(true);

		// 401 → permanent, removed immediately with a remediation diagnostic
		const authError = transportMock(() => ({
			status: 401,
			headers: {},
			text: async () => "",
		}));
		const rejected = await makeReporter({ transport: authError.post });
		rejected.reporter.captureException(validInput);
		const rejectedDiags: Array<{ code: string }> = [];
		rejected.reporter.onDiagnostic((d) => rejectedDiags.push(d));
		await rejected.reporter.flush();
		expect(rejected.reporter.pendingCount).toBe(0);
		expect(rejectedDiags.some((d) => d.code === "error_batch_rejected")).toBe(
			true,
		);
	});
});
