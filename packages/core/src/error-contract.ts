import type {
	CollectionState,
	JsonObject,
	PrismDiagnostic,
	PrismDiagnosticHandle,
	PrismRuntimeAdapter,
} from "./contract";

/**
 * Frozen public contract for the error-reporting capability
 * (task-15 slice 3 — Core error capability, ADR 0002 §7 discipline).
 *
 * Error delivery is a SEPARATE lane from `track()` analytics delivery:
 * its own bounded queue, batching, retry classification, and diagnostics.
 * It reuses the SAME runtime-neutral seams (runtime adapter, transport,
 * consent, sanitizer) but carries its own wire envelope (`schemaVersion: 1`
 * matching POST /api/v1/errors/ingest, frozen in slice 1) and its own
 * idempotency keys (client event ids).
 *
 * Rules:
 * - Runtime-neutral: no DOM, Node, React, or process globals; the adapter
 *   is injected and no default hosted endpoint is compiled in.
 * - Error reporting is EXPLICIT and OPT-IN: `createPrismErrorReporter` must
 *   be called deliberately; global handlers are NOT installed by core.
 * - Invalid CALLER input THROWS a specific validation error; consent,
 *   shutdown, and queue-capacity conditions return `dropped`.
 * - The reporter never revives identity: session / anonymous / person
 *   references and global properties are COPIED only when consent is
 *   granted, through a sanitized snapshot, never inferred by the reporter.
 */

export type ErrorLevel = "error" | "warning";

/** A normalized stack frame (the wire shape the ingestion server accepts). */
export interface ErrorFrame {
	file?: string;
	function?: string;
	line?: number;
	column?: number;
	inApp?: boolean;
}

/** A normalized breadcrumb (bounded; the server re-validates). */
export interface ErrorBreadcrumb {
	timestamp?: number;
	type?: string;
	message?: string;
	level?: "debug" | "info" | "warning" | "error";
}

/**
 * Developer-facing input to `captureException`. `occurredAt` is NOT part
 * of the developer shape — the reporter stamps the capture time. `cause`
 * may be a nested `{ type, message?, frames?, cause? }` chain (depth
 * bounded at acceptance); anything deeper is preserved as opaque JSON and
 * the server truncates the persisted chain to its own ceiling.
 */
export interface ErrorReportInput {
	exception: {
		type: string;
		message?: string;
		frames?: Array<ErrorFrame>;
		cause?: unknown;
	};
	level?: ErrorLevel;
	handled?: boolean;
	release?: string;
	environment?: string;
	context?: {
		/** Scalar tags (string | number | boolean values only). */
		tags?: Record<string, string | number | boolean>;
		/** Arbitrary JSON extras (sanitized, credentials redacted). */
		extras?: JsonObject;
	};
	breadcrumbs?: Array<Record<string, unknown>>;
}

/**
 * The validated, bounded, sanitized report AFTER client normalization and
 * DEV-side `beforeSend`. This is the immutable object passed to
 * `beforeSend` (which may return a redacted copy) and then serialized.
 */
export interface ErrorReport {
	readonly id: string;
	readonly occurredAt: number;
	readonly level: ErrorLevel;
	readonly handled: boolean;
	readonly exception: {
		readonly type: string;
		readonly message?: string;
		readonly frames?: readonly ErrorFrame[];
		readonly cause?: unknown;
	};
	readonly release?: string;
	readonly environment?: string;
	readonly context?: {
		readonly tags?: Readonly<Record<string, string | number | boolean>>;
		readonly extras?: Readonly<Record<string, unknown>>;
	};
	readonly breadcrumbs?: readonly ErrorBreadcrumb[];
	/*
	 * Attached only when consent is granted + the share source has a value:
	 * anonymousId rides on the wire; sessionId/userId are REPORT-level only
	 * (available to beforeSend) because the frozen ingest schema has no
	 * session/user fields yet — a strict server.
	 */
	readonly anonymousId?: string;
	readonly sessionId?: string;
	readonly userId?: string;
}

/**
 * The `beforeSend` boundary: receives the immutable report, returns a
 * decision. Returning `{ kind: "drop", ... }` discards the report (a
 * `dropped` capture result + diagnostic). Returning `{ kind: "send" }`
 * delivers the (possibly redacted) returned report. The boundary must not
 * throw — if it does, the ORIGINAL report is sent and a coarse diagnostic
 * is emitted (the reporter never lets a dev hook crash capture).
 */
export type ErrorBeforeSend = (
	report: Readonly<ErrorReport>,
) =>
	| { readonly kind: "send"; readonly report: ErrorReport }
	| { readonly kind: "drop"; readonly reason: string };

/** Reasons an error report can be dropped without being queued. */
export type ErrorDropReason =
	| "consent-pending"
	| "consent-denied"
	| "queue-full"
	| "shutdown"
	| "invalid-report";

/** Discriminated result of every `captureException()` call. */
export type ErrorCaptureResult =
	| { readonly status: "queued"; readonly id: string }
	| { readonly status: "dropped"; readonly reason: ErrorDropReason };

/** The wire error item (mirrors the frozen ingest schemaVersion 1 shape). */
export interface WireErrorItem {
	id: string;
	occurredAt: number;
	level: ErrorLevel;
	handled: boolean;
	exception: {
		type: string;
		message?: string;
		frames?: Array<ErrorFrame>;
		cause?: unknown;
	};
	release?: string;
	environment?: string;
	context?: {
		tags?: Record<string, string | number | boolean>;
		extras?: Record<string, unknown>;
	};
	breadcrumbs?: Array<Record<string, unknown>>;
	anonymousId?: string;
}

/** The frozen batch envelope for POST /api/v1/errors/ingest. */
export interface WireErrorBatch {
	schemaVersion: 1;
	sentAt: number;
	sdk: { name: string; version: string };
	errors: Array<WireErrorItem>;
}

/**
 * Safe reporter/client context sharing (task-15 §3): the reporter NEVER
 * reads browser/tab globals or a shared client's internals. The host wires
 * a `share` source; the reporter copies only the sanctioned fields into
 * each report, and ONLY when consent is granted.
 */
export interface ErrorReporterShare {
	/** Current analytics collection state (pending/granted/denied). */
	consent(): CollectionState;
	/** Current anonymous id, or null. */
	anonymousId?(): string | null;
	/** Active session id, or null. */
	sessionId?(): string | null;
	/** Known external user id, or null. */
	userId?(): string | null;
	/** Global properties to MERGE under the report (sanitized before attach). */
	globalProperties?(): JsonObject;
}

/** Reporter queue/delivery tuning. All optional with documented defaults. */
export interface ErrorReporterOptions {
	/** Project source key (ingestion auth; server derives project/source). */
	sourceKey: string;
	/** Ingestion origin chosen at runtime (hosted or self-hosted). */
	endpoint: string;
	/** Host adapter — the SAME seam as the analytics client. */
	runtime: PrismRuntimeAdapter;
	/** Safe identity/consent sharing source (wired by the host). */
	share: ErrorReporterShare;
	/** Optional dev-side boundary. Runs after normalization, before queue. */
	beforeSend?: ErrorBeforeSend;
	queue?: {
		/** Max queued reports before new ones drop. Default 50. */
		maxQueueErrors?: number;
		/** Max total serialized queue bytes. Default 512 KiB. */
		maxQueueBytes?: number;
		/** Max reports per batch. Default 50 (server ceiling). */
		maxBatchErrors?: number;
		/** Max serialized bytes per batch. Default 256 KiB. */
		maxBatchBytes?: number;
		/** Per-request timeout in ms. Default 10_000. */
		requestTimeoutMs?: number;
		/** Background flush interval in ms. Default 10_000. */
		flushIntervalMs?: number;
		/** Max delivery attempts per batch. Default 5. */
		maxRetries?: number;
	};
	/** Diagnostic subscription made BEFORE the reporter starts. */
	onDiagnostic?: (diagnostic: PrismDiagnostic) => void;
}

/**
 * The ready error reporter. All observed state is readonly; queueing is
 * the only mutation path.
 */
export interface PrismErrorReporter {
	readonly sourceKey: string;
	readonly endpoint: string;
	/** Number of queued (undelivered) error reports. */
	readonly pendingCount: number;
	/**
	 * Validate, sanitize, attach shared context (consent-gated), run
	 * `beforeSend`, and enqueue. Synchronous. Invalid caller input THROWS;
	 * consent/shutdown/queue-capacity/`beforeSend`-drop return `dropped`.
	 */
	captureException(input: ErrorReportInput): ErrorCaptureResult;
	/** Attempt delivery of all queued batches. Rejects on outright failure. */
	flush(): Promise<void>;
	/** Idempotent shutdown: stop timers, bounded final flush, close. */
	shutdown(options?: { timeoutMs?: number }): Promise<void>;
	/** Subscribe to diagnostics; returns an idempotent remove handle. */
	onDiagnostic(
		listener: (diagnostic: PrismDiagnostic) => void,
	): PrismDiagnosticHandle;
}

/** Async factory: validates options and resolves to a READY reporter. */
export declare function createPrismErrorReporter(
	options: ErrorReporterOptions,
): Promise<PrismErrorReporter>;
