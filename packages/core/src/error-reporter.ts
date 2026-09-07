import type {
	CollectionState,
	PrismDiagnostic,
	PrismDiagnosticHandle,
	PrismRuntimeAdapter,
	PrismSignal,
} from "./contract";
import type {
	ErrorCaptureResult,
	ErrorReport,
	ErrorReportInput,
	ErrorReporterOptions,
	PrismErrorReporter,
	WireErrorBatch,
	WireErrorItem,
} from "./error-contract";
import { ERROR_LIMITS } from "./error-limits";
import {
	attachSharedContext,
	normalizeErrorReport,
	toWireErrorItem,
} from "./error-validation";
import { SDK_NAME, SDK_VERSION } from "./limits";
import { utf8Length } from "./queue";
import { assertEndpoint, assertSourceKey } from "./validation";

/**
 * Runtime-neutral error reporter (task-15 slice 3).
 *
 * A SEPARATE delivery lane from analytics `track()`: its own bounded FIFO,
 * batching, idempotency keys (client event ids), and retry classification.
 * It never reads browser/tab/React/process globals — the adapter + a
 * consent/share source are injected. The server re-validates + re-sanitizes
 * everything; this module guarantees the SDK never produces an item the
 * server must reject as oversized or malformed.
 */

/** djb2 string hash — deterministic jitter without platform globals. */
function hashString(value: string): number {
	let hash = 5381;
	for (let i = 0; i < value.length; i += 1)
		hash = (hash * 33) ^ value.charCodeAt(i);
	return hash >>> 0;
}

const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;
const MAX_TIMER_MS = 2_147_483_647;

function parseRetryAfterSeconds(
	header: string | undefined,
	now: number,
): number | undefined {
	if (!header) return undefined;
	const trimmed = header.trim();
	if (trimmed.length === 0) return undefined;
	const seconds = Number(trimmed);
	if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
	const dateMs = Date.parse(trimmed);
	if (Number.isFinite(dateMs)) {
		const delay = dateMs - now;
		if (delay > 0) return delay;
	}
	return undefined;
}

type AbortableSignal = PrismSignal & { abort(): void };

function createSignal(): AbortableSignal {
	let aborted = false;
	const listeners = new Set<() => void>();
	return {
		get aborted() {
			return aborted;
		},
		addEventListener: (_type, listener) => {
			listeners.add(listener);
		},
		removeEventListener: (_type, listener) => {
			listeners.delete(listener);
		},
		abort: () => {
			if (aborted) return;
			aborted = true;
			for (const listener of listeners) listener();
			listeners.clear();
		},
	};
}

function withTimeout<T>(
	promise: Promise<T>,
	timeoutMs: number,
	runtime: PrismRuntimeAdapter,
): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const cancel = runtime.schedule(timeoutMs, () =>
			reject(new Error("timed out")),
		);
		promise.then(
			(value) => {
				cancel();
				resolve(value);
			},
			(error) => {
				cancel();
				reject(error);
			},
		);
	});
}

interface QueuedReport {
	readonly id: string;
	readonly serialized: string;
}

const DEFAULT_QUEUE = {
	maxQueueErrors: ERROR_LIMITS.maxErrorsPerBatch, // 50
	maxQueueBytes: ERROR_LIMITS.maxQueueBytes, // 512 KiB
	maxBatchErrors: ERROR_LIMITS.maxErrorsPerBatch, // 50
	maxBatchBytes: ERROR_LIMITS.maxBatchBytes, // 256 KiB
	requestTimeoutMs: 10_000,
	flushIntervalMs: 10_000,
	maxRetries: 5,
};

class ErrorReporterImpl implements PrismErrorReporter {
	readonly sourceKey: string;
	readonly endpoint: string;
	private readonly runtime: PrismRuntimeAdapter;
	private readonly share: ErrorReporterOptions["share"];
	private readonly beforeSend: ErrorReporterOptions["beforeSend"];
	private readonly queue: Required<NonNullable<ErrorReporterOptions["queue"]>>;
	private readonly diagnostics = new Set<(d: PrismDiagnostic) => void>();
	private readonly items: QueuedReport[] = [];
	private closed = false;
	private flushPromise: Promise<void> | null = null;
	private cancelTimer: (() => void) | null = null;
	private retryCancel: (() => void) | null = null;
	private attempts = new Map<string, number>();
	private lifecycleRemovers: Array<() => void> = [];

	constructor(options: ErrorReporterOptions) {
		assertSourceKey(options.sourceKey);
		assertEndpoint(options.endpoint);
		const runtime = options.runtime;
		if (
			!runtime ||
			typeof runtime.now !== "function" ||
			typeof runtime.createId !== "function" ||
			typeof runtime.schedule !== "function" ||
			!runtime.transport ||
			typeof runtime.transport.post !== "function" ||
			!runtime.context
		) {
			throw new Error(
				"runtime adapter is required (transport, schedule, now, createId, context)",
			);
		}
		if (!options.share || typeof options.share.consent !== "function") {
			throw new Error(
				"error reporter requires a share source with a consent() function",
			);
		}
		this.sourceKey = options.sourceKey;
		this.endpoint = options.endpoint.replace(/\/$/, "");
		this.runtime = runtime;
		this.share = options.share;
		this.beforeSend = options.beforeSend;
		this.queue = { ...DEFAULT_QUEUE, ...options.queue };
		if (options.onDiagnostic) this.diagnostics.add(options.onDiagnostic);

		// Background flush loop through the runtime seam (analytics-client
		// semantics). Also a best-effort flush before unload, when the host
		// surfaces it — never a secret-bearing or auth-less fallback.
		const interval = this.queue.flushIntervalMs;
		const loop = async (): Promise<void> => {
			if (this.closed) return;
			await this.tick();
			if (this.closed) return;
			this.cancelTimer = runtime.schedule(interval, loop);
		};
		this.cancelTimer = runtime.schedule(interval, loop);
		if (runtime.lifecycle) {
			this.lifecycleRemovers.push(
				runtime.lifecycle.on("before-unload", () => {
					void this.tick();
				}),
			);
		}
	}

	get pendingCount(): number {
		return this.items.length;
	}

	captureException(input: ErrorReportInput): ErrorCaptureResult {
		const id = this.runtime.createId();
		const occurredAt = this.runtime.now();

		// 1) Consent gate FIRST — no normalization work under denial.
		const consent = this.readConsent();
		if (consent === "pending") {
			this.emit(
				"debug",
				"error_consent_pending",
				"error report dropped (consent pending)",
			);
			return { status: "dropped", reason: "consent-pending" };
		}
		if (consent === "denied") {
			this.emit(
				"debug",
				"error_consent_denied",
				"error report dropped (consent denied)",
			);
			return { status: "dropped", reason: "consent-denied" };
		}
		if (this.closed) return { status: "dropped", reason: "shutdown" };

		// 2) Validate + normalize (throws on structurally invalid caller input).
		let report: ErrorReport;
		try {
			report = normalizeErrorReport(input, id, occurredAt);
		} catch (error) {
			// Invalid CALLER input throws (contract rule) — but never leak the
			// exception contents in diagnostics.
			throw error instanceof Error ? error : new Error("invalid error report");
		}

		// 3) Attach SHARED context — consent-granted path only. The reporter
		//    copies sanctioned field values; it never infers or revives identity.
		const shared = this.readSharedContext();
		if (shared !== null) {
			report = attachSharedContext(report, shared, 12);
		}

		// 4) beforeSend boundary — immutable in, may redact or drop. A throw
		//    sends the original (never lets a dev hook crash capture).
		const beforeSend = this.beforeSend;
		if (beforeSend) {
			let decision: ReturnType<NonNullable<ErrorReporterOptions["beforeSend"]>>;
			try {
				decision = beforeSend(report);
			} catch {
				this.emit(
					"error",
					"before_send_error",
					"beforeSend threw; original report sent",
				);
				decision = { kind: "send", report };
			}
			if (decision.kind === "drop") {
				this.emit(
					"warn",
					"error_before_send_dropped",
					"error report dropped by beforeSend",
				);
				return { status: "dropped", reason: "invalid-report" };
			}
			report = { ...decision.report, id, occurredAt };
		}

		// 5) Bounded enqueue with byte accounting (matches the server cap).
		const item: WireErrorItem = toWireErrorItem(report);
		const serialized = JSON.stringify(item);
		if (utf8Length(serialized) > this.queue.maxBatchBytes) {
			this.emit(
				"warn",
				"error_too_large",
				"error report exceeds the batch ceiling",
			);
			return { status: "dropped", reason: "queue-full" };
		}
		if (
			this.items.length + 1 > this.queue.maxQueueErrors ||
			this.queueBytes() + utf8Length(serialized) > this.queue.maxQueueBytes
		) {
			this.emit("warn", "error_queue_full", "error queue is full");
			return { status: "dropped", reason: "queue-full" };
		}
		this.items.push({ id, serialized });

		// 6) Request delivery when the batch threshold is reached.
		if (
			this.items.length >= this.queue.maxBatchErrors ||
			this.queueBytes() >= this.queue.maxBatchBytes
		) {
			void this.flush().catch(() => {
				// failure surfaces via diagnostics + flush rejection
			});
		}
		return { status: "queued", id };
	}

	flush(): Promise<void> {
		if (this.flushPromise) return this.flushPromise;
		this.flushPromise = this.doFlush().finally(() => {
			this.flushPromise = null;
		});
		return this.flushPromise;
	}

	async shutdown(options?: { timeoutMs?: number }): Promise<void> {
		if (this.closed) return;
		this.closed = true;
		this.cancelTimer?.();
		this.cancelTimer = null;
		this.retryCancel?.();
		this.retryCancel = null;
		for (const remove of this.lifecycleRemovers) remove();
		this.lifecycleRemovers.length = 0;
		const timeoutMs = options?.timeoutMs ?? 10_000;
		try {
			await withTimeout(this.flush(), timeoutMs, this.runtime);
		} catch {
			this.emit(
				"warn",
				"error_shutdown_flush_failed",
				"final error flush did not complete",
			);
		}
		this.retryCancel = null;
	}

	onDiagnostic(listener: (d: PrismDiagnostic) => void): PrismDiagnosticHandle {
		this.diagnostics.add(listener);
		let removed = false;
		return {
			remove: () => {
				if (removed) return;
				removed = true;
				this.diagnostics.delete(listener);
			},
		};
	}

	private queueBytes(): number {
		return this.items.reduce(
			(sum, entry) => sum + utf8Length(entry.serialized),
			0,
		);
	}

	private readConsent(): CollectionState {
		try {
			const state = this.share.consent();
			return state === "pending" || state === "denied" || state === "granted"
				? state
				: "denied";
		} catch {
			// A broken share source must never silently collect.
			return "denied";
		}
	}

	private readSharedContext(): {
		anonymousId?: string | null;
		sessionId?: string | null;
		userId?: string | null;
		globalProperties?: Record<string, unknown>;
	} | null {
		const context: Record<string, unknown> = {};
		let any = false;
		const read = (key: "anonymousId" | "sessionId" | "userId"): void => {
			const fn = this.share[key];
			if (fn) {
				try {
					const value = fn();
					if (value !== null && value !== undefined) {
						context[key] = value;
						any = true;
					}
				} catch {
					// a failing share getter contributes nothing
				}
			}
		};
		read("anonymousId");
		read("sessionId");
		read("userId");
		const globals = this.share.globalProperties?.();
		if (globals && typeof globals === "object") {
			context.globalProperties = globals as Record<string, unknown>;
			any = true;
		}
		return any
			? (context as {
					anonymousId?: string | null;
					sessionId?: string | null;
					userId?: string | null;
					globalProperties?: Record<string, unknown>;
				})
			: null;
	}

	private emit(
		level: PrismDiagnostic["level"],
		code: string,
		message: string,
	): void {
		const diagnostic: PrismDiagnostic = {
			level,
			code,
			message,
			timestamp: this.runtime.now(),
		};
		for (const listener of [...this.diagnostics]) {
			try {
				listener(diagnostic);
			} catch {
				// a listener must never break the reporter
			}
		}
	}

	private async tick(): Promise<void> {
		if (this.closed || this.items.length === 0) return;
		try {
			await this.flush();
		} catch {
			// surfaced via diagnostics + flush rejection
		}
	}

	private async doFlush(): Promise<void> {
		// Consent gate: error delivery never transmits under pending/denied.
		if (this.readConsent() !== "granted") return;
		while (this.items.length > 0) {
			if (this.readConsent() !== "granted") return;
			const batch = this.peekBatch();
			if (batch.length === 0) break;
			const signal = createSignal();
			let outcome: DeliverOutcome;
			try {
				outcome = await this.deliver(batch, signal);
			} catch {
				outcome = {
					ok: false,
					error: new Error("error batch delivery interrupted"),
					exhausted: false,
				};
			}
			if (!outcome.ok) {
				if (outcome.exhausted) {
					this.removeBatch(batch.map((entry) => entry.id));
				}
				throw outcome.error;
			}
			this.removeBatch(batch.map((entry) => entry.id));
			this.attempts.delete(batch[0]?.id ?? "");
		}
	}

	private peekBatch(): QueuedReport[] {
		const batch: QueuedReport[] = [];
		let bytes = 0;
		for (const entry of this.items) {
			if (batch.length >= this.queue.maxBatchErrors) break;
			const encoded = utf8Length(entry.serialized);
			if (batch.length > 0 && bytes + encoded > this.queue.maxBatchBytes) break;
			batch.push(entry);
			bytes += encoded;
		}
		return batch;
	}

	private removeBatch(ids: string[]): void {
		const idSet = new Set(ids);
		const kept: QueuedReport[] = [];
		for (const entry of this.items) {
			if (!idSet.has(entry.id)) kept.push(entry);
		}
		this.items.length = 0;
		this.items.push(...kept);
	}

	private async deliver(
		batch: QueuedReport[],
		signal: AbortableSignal,
	): Promise<DeliverOutcome> {
		const body: WireErrorBatch = {
			schemaVersion: 1,
			sentAt: this.runtime.now(),
			sdk: { name: SDK_NAME, version: SDK_VERSION, language: "javascript" },
			errors: batch.map(
				(entry) => JSON.parse(entry.serialized) as WireErrorItem,
			),
		};
		const request = {
			body: JSON.stringify(body),
			headers: {
				authorization: `Bearer ${this.sourceKey}`,
				"content-type": "application/json",
			},
			timeoutMs: this.queue.requestTimeoutMs,
			signal,
		};
		let response;
		try {
			response = await this.runtime.transport.post(
				`${this.endpoint}/api/v1/errors/ingest`,
				request,
			);
		} catch (error) {
			if (signal.aborted) {
				this.emit(
					"warn",
					"error_delivery_cancelled",
					"in-flight error delivery cancelled",
				);
				return {
					ok: false,
					error: new Error("error batch delivery cancelled"),
					exhausted: false,
				};
			}
			// Coarse error only — never transport text (it may embed the key).
			const coarse = new Error("error batch delivery failed");
			const exhausted = this.handleFailure(batch, coarse);
			return { ok: false, error: coarse, exhausted };
		}
		if (response.status >= 200 && response.status < 300) {
			return { ok: true, kind: "accepted" };
		}
		if (
			response.status === 400 ||
			response.status === 401 ||
			response.status === 403 ||
			response.status === 413
		) {
			this.emit(
				"error",
				"error_batch_rejected",
				`error ingest rejected the batch (${response.status}) — it will not be retried (fix the payload)`,
			);
			return { ok: true, kind: "accepted" };
		}
		const error = new Error(`error ingest responded ${response.status}`);
		const retryAfterMs = parseRetryAfterSeconds(
			response.headers["retry-after"],
			this.runtime.now(),
		);
		this.emit(
			"warn",
			"error_rate_limited",
			`error ingest responded ${response.status}${
				retryAfterMs !== undefined
					? ` (retry-after ${Math.round(retryAfterMs / 1000)}s)`
					: " (no valid retry-after; using backoff)"
			}`,
		);
		const exhausted = this.handleFailure(batch, error, retryAfterMs);
		return { ok: false, error, exhausted };
	}

	private handleFailure(
		batch: QueuedReport[],
		error: unknown,
		retryAfterMs?: number,
	): boolean {
		const key = batch[0]?.id ?? "unknown";
		const attempts = (this.attempts.get(key) ?? 0) + 1;
		this.attempts.set(key, attempts);
		this.emit("warn", "error_delivery_failed", "error batch delivery failed");
		if (attempts >= this.queue.maxRetries) {
			this.attempts.delete(key);
			this.emit(
				"error",
				"error_batch_dropped",
				`error batch dropped after ${attempts} failed attempts`,
			);
			return true;
		}
		this.scheduleRetry(attempts, retryAfterMs);
		return false;
	}

	private scheduleRetry(attempt: number, retryAfterMs?: number): void {
		if (this.retryCancel || this.closed) return;
		let cancelled = false;
		let activeCancel: (() => void) | null = null;
		this.retryCancel = () => {
			cancelled = true;
			activeCancel?.();
			activeCancel = null;
		};
		const exponential = Math.min(
			RETRY_BASE_MS * 2 ** (attempt - 1),
			RETRY_MAX_MS,
		);
		const jitter =
			0.8 + (0.4 * (hashString(String(exponential)) % 1000)) / 1000;
		const delayMs =
			retryAfterMs !== undefined
				? retryAfterMs
				: Math.max(1, Math.round(exponential * jitter));
		const fire = (): void => {
			activeCancel = null;
			this.retryCancel = null;
			if (cancelled || this.closed) return;
			void this.tick();
		};
		const scheduleChunk = (remaining: number): void => {
			if (cancelled || this.closed) return;
			const chunk = Math.min(remaining, MAX_TIMER_MS);
			activeCancel = this.runtime.schedule(chunk, () => {
				activeCancel = null;
				if (cancelled || this.closed) return;
				if (remaining - chunk <= 0) {
					fire();
				} else {
					scheduleChunk(remaining - chunk);
				}
			});
		};
		scheduleChunk(delayMs);
		this.emit(
			"debug",
			"error_retry_scheduled",
			`error retry ${attempt} scheduled in ${delayMs} ms`,
		);
	}
}

type DeliverOutcome =
	| { readonly ok: true; readonly kind: "accepted" }
	| {
			readonly ok: false;
			readonly error: unknown;
			readonly exhausted: boolean;
	  };

/**
 * Async factory: validates options and resolves to a READY reporter.
 * Construction errors (invalid source key / endpoint / adapter / share)
 * reject the returned promise rather than throwing synchronously.
 */
export async function createPrismErrorReporter(
	options: ErrorReporterOptions,
): Promise<PrismErrorReporter> {
	return new ErrorReporterImpl(options);
}
