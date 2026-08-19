import type {
	ErrorBeforeSend,
	ErrorCaptureResult,
	ErrorReporterOptions,
	ErrorReporterShare,
	ErrorReportInput,
	PrismDiagnostic,
	PrismDiagnosticHandle,
	PrismErrorReporter,
} from "@prism-analytics/core";
import { createPrismErrorReporter, framesFromStack } from "@prism-analytics/core";
import { createNodeRuntime } from "./node-runtime";

/**
 * Node/server error adapter (task-15 Phase 4) — `createNodeErrorReporter`.
 *
 * Translates server failure primitives (Error, strings, arbitrary rejected
 * values) into the core's `ErrorReportInput` shape and drives the generic
 * `createPrismErrorReporter` lane from `@prism-analytics/core`, exactly like
 * the browser adapter but for non-browser runtimes.
 *
 * Ownership rules that keep it safe in a long-running server:
 *  - It does NOT install `uncaughtException` or `unhandledRejection`
 *    handlers by default — the application owns crash/restart policy.
 *    `captureProcessErrors()` is the EXPLICIT opt-in, returning an
 *    uninstall handle, when an app genuinely wants Prism to observe
 *    unhandled failures before its own restart logic.
 *  - Flush-on-shutdown is best-effort via the runtime lifecycle
 *    (beforeExit/SIGINT/SIGTERM) — the reporter's own `shutdown()`
 *    remains the deterministic close, with a bounded final flush.
 *  - Request context is EXPLICIT per capture because Node is concurrent:
 *    there is intentionally NO ambient request-scoped global that could
 *    leak a user id or auth header across concurrent requests. Pass
 *    `context`/`tags` to `captureException` per call.
 */
export interface NodeErrorReporterOptions {
	/** Project source key (ingestion auth; server derives project/source). */
	sourceKey: string;
	/** Ingestion origin chosen at runtime — REQUIRED, never compiled in. */
	endpoint: string;
	/** Safe identity/consent sharing source (wire the analytics client's). */
	share: ErrorReporterShare;
	/** Optional dev-side boundary (immutable in; drop/redact/throw-safe). */
	beforeSend?: ErrorBeforeSend;
	/** Queue/delivery tuning passthrough to the core reporter. */
	queue?: ErrorReporterOptions["queue"];
	/** Optional release + environment stamped on every report. */
	release?: string;
	environment?: string;
	/** Opt-in diagnostic subscription made BEFORE the reporter starts. */
	onDiagnostic?: (diagnostic: PrismDiagnostic) => void;
	/** Narrow the flush-on-shutdown signal set. Default graceful set only. */
	signals?: NodeJS.Signals[];
}

export interface NodeCaptureOptions {
	/** Default `false` — a server capture is an unhandled failure. */
	handled?: boolean;
	level?: ErrorReportInput["level"];
	release?: string;
	environment?: string;
	/** Explicit per-request context — NEVER ambient (Node concurrency). */
	context?: ErrorReportInput["context"];
	breadcrumbs?: ErrorReportInput["breadcrumbs"];
}

export interface NodeErrorReporter {
	/** The underlying runtime-neutral reporter (flush/shutdown/diagnostics). */
	readonly reporter: PrismErrorReporter;
	readonly pendingCount: number;
	/**
	 * Normalize ANY thrown/collected value into an error report and enqueue
	 * it. Invalid callers passing a malformed ErrorReportInput still THROW
	 * (same contract as core). Consent/shutdown/queue-capacity return
	 * `dropped`.
	 */
	captureException(
		value: unknown,
		options?: NodeCaptureOptions,
	): ErrorCaptureResult;
	/**
	 * EXPLICIT opt-in to `process.on("uncaughtException")` +
	 * `"unhandledRejection"`. Returns an uninstall handle. Prism observes
	 * but NEVER rethrows or changes process exit behavior — restart policy
	 * stays the application's. Idempotent install.
	 */
	captureProcessErrors(options?: {
		/** Called when a capture happens through a process handler. */
		onCapture?: (result: ErrorCaptureResult) => void;
	}): () => void;
	/** Attempt delivery of all queued batches. */
	flush(): Promise<void>;
	/** Idempotent shutdown: cancel timers, bounded final flush. */
	shutdown(options?: { timeoutMs?: number }): Promise<void>;
	/** Subscribe to diagnostics; returns an idempotent remove handle. */
	onDiagnostic(listener: (d: PrismDiagnostic) => void): PrismDiagnosticHandle;
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function looksLikeErrorReportInput(value: unknown): value is ErrorReportInput {
	return (
		isPlainRecord(value) &&
		isPlainRecord(value.exception) &&
		typeof (value.exception as { type?: unknown }).type === "string"
	);
}

function safeMessage(message: unknown, fallback = "Error"): string {
	const text =
		typeof message === "string" && message.length > 0 ? message : fallback;
	return text.length > 2048 ? `${text.slice(0, 2048)}…` : text;
}

/** Bounded, circular-safe summary of a non-Error rejection reason. */
function describeUnknown(value: unknown, depth = 0): string {
	if (depth > 2) return "[object]";
	if (typeof value === "string") return value;
	if (
		typeof value === "number" ||
		typeof value === "boolean" ||
		value === null ||
		value === undefined
	)
		return String(value);
	try {
		const seen = new Set<unknown>();
		const text = JSON.stringify(value, (_k, v) => {
			if (typeof v === "object" && v !== null) {
				if (seen.has(v)) return "[Circular]";
				seen.add(v);
			}
			if (typeof v === "function") return "[Function]";
			return v;
		});
		if (text && text.length <= 256) return text;
		return "[object]";
	} catch {
		return "[object]";
	}
}

/**
 * Normalize ANY collected value into an ErrorReportInput for server
 * runtimes: Error instances (frames from stack), strings, plain objects
 * that already match the report shape (passthrough), duck-typed Errors,
 * and opaque rejection reasons (summarized, never thrown).
 */
export function normalizeNodeErrorValue(value: unknown): ErrorReportInput {
	if (typeof value === "string") {
		return { exception: { type: "Error", message: value } };
	}
	if (value instanceof Error) {
		return {
			exception: {
				type: value.name || "Error",
				message: safeMessage(value.message),
				frames: framesFromStack(value.stack),
			},
		};
	}
	if (isPlainRecord(value)) {
		const record = value;
		if (looksLikeErrorReportInput(record)) {
			return record as ErrorReportInput;
		}
		const name = record.name;
		const message = record.message;
		if (
			typeof name === "string" &&
			name.length > 0 &&
			typeof message === "string"
		) {
			return {
				exception: {
					type: name,
					message: safeMessage(message),
					frames: framesFromStack(
						typeof record.stack === "string" ? record.stack : undefined,
					),
				},
			};
		}
		if (typeof message === "string" && message.length > 0) {
			return {
				exception: { type: "Error", message: safeMessage(message) },
			};
		}
		return {
			exception: {
				type: "Error",
				message: describeUnknown(record),
			},
		};
	}
	return {
		exception: { type: "Error", message: describeUnknown(value) },
	};
}

export async function createNodeErrorReporter(
	options: NodeErrorReporterOptions,
): Promise<NodeErrorReporter> {
	if (!options.endpoint || options.endpoint.trim().length === 0) {
		throw new Error(
			"endpoint is required — choose the ingestion origin at runtime",
		);
	}
	if (!options.share || typeof options.share.consent !== "function") {
		throw new Error("share is required — wire the analytics client's consent");
	}
	const runtime = createNodeRuntime({ signals: options.signals });
	const reporter = await createPrismErrorReporter({
		sourceKey: options.sourceKey,
		endpoint: options.endpoint,
		runtime,
		share: options.share,
		beforeSend: options.beforeSend,
		queue: options.queue,
		...("onDiagnostic" in options && options.onDiagnostic
			? { onDiagnostic: options.onDiagnostic }
			: {}),
	});

	const capture = (
		value: unknown,
		captureOptions?: NodeCaptureOptions,
	): ErrorCaptureResult => {
		let input: ErrorReportInput;
		try {
			input = normalizeNodeErrorValue(value);
		} catch (error) {
			throw error instanceof Error ? error : new Error("invalid error report");
		}
		const release =
			captureOptions?.release ?? options.release ?? input.release;
		const environment =
			captureOptions?.environment ?? options.environment ?? input.environment;
		input = {
			...input,
			...(release ? { release } : {}),
			...(environment ? { environment } : {}),
			...(captureOptions?.level ? { level: captureOptions.level } : {}),
			...(captureOptions?.context ? { context: captureOptions.context } : {}),
			...(captureOptions?.breadcrumbs
				? { breadcrumbs: captureOptions.breadcrumbs }
				: {}),
			...("handled" in (captureOptions ?? {})
				? { handled: captureOptions?.handled }
				: { handled: false }),
		};
		return reporter.captureException(input);
	};

	let processHandlersInstalled = false;
	const processUninstall = (): void => {
		process.removeListener("uncaughtException", onUncaught);
		process.removeListener("unhandledRejection", onUnhandled);
		processHandlersInstalled = false;
	};
	// eslint-disable-next-line prefer-const
	let onUncaught = (_error: Error): void => {};
	// eslint-disable-next-line prefer-const
	let onUnhandled = (_reason: unknown): void => {};

	const captureProcessErrors = (config?: {
		onCapture?: (result: ErrorCaptureResult) => void;
	}): (() => void) => {
		if (processHandlersInstalled) return processUninstall;
		processHandlersInstalled = true;
		onUncaught = (error: unknown): void => {
			const result = capture(error, { handled: false });
			config?.onCapture?.(result);
		};
		onUnhandled = (reason: unknown): void => {
			const result = capture(reason, { handled: false });
			config?.onCapture?.(result);
		};
		process.on("uncaughtException", onUncaught);
		process.on("unhandledRejection", onUnhandled);
		return processUninstall;
	};

	return {
		reporter,
		get pendingCount() {
			return reporter.pendingCount;
		},
		captureException: capture,
		captureProcessErrors,
		flush: () => reporter.flush(),
		shutdown: (opts) => reporter.shutdown(opts),
		onDiagnostic: (listener) => reporter.onDiagnostic(listener),
	};
}
