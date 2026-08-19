/**
 * Frozen limits for POST /api/v1/errors/ingest (task-15 slice 1).
 *
 * Error payloads are bounded by design: messages, exception chains, stack
 * frames, tags/extras and breadcrumbs all carry hard ceilings so one
 * hostile item can never balloon storage or CPU. These constants are the
 * server-side contract; the SDK slice mirrors them client-side.
 */
export const ERROR_INGEST_LIMITS = {
	/** Max serialized request body (bounded stream read enforces it). */
	maxBatchBytes: 256 * 1024,
	/** Max error items per batch. */
	maxErrorsPerBatch: 50,
	/** Exception chain depth (top exception = 1). */
	maxExceptionChain: 3,
	/** Max stack frames per exception (top first). */
	maxFramesPerException: 32,
	/** Max exception type length. */
	maxTypeLength: 128,
	/** Max normalized message length. */
	maxMessageLength: 512,
	/** Max URL length after sanitization. */
	maxUrlLength: 1024,
	/** Max tags / extras entries per item. */
	maxContextEntries: 50,
	/** Max context key length. */
	maxContextKeyLength: 64,
	/** Max scalar string length inside tags/extras. */
	maxContextStringLength: 512,
	/** Max breadcrumbs per item. */
	maxBreadcrumbs: 30,
	/** Max breadcrumb message length. */
	maxBreadcrumbMessageLength: 512,
	/** Max release / environment length. */
	maxReleaseLength: 128,
	/** Max client event id length. */
	maxClientEventIdLength: 128,
	/** Max anonymous id length (ids are opaque strings). */
	maxAnonymousIdLength: 128,
	/** Storage/abuse cap: live issues per project (new groups rejected above). */
	maxIssuesPerProject: 10_000,
	/** Storage/abuse cap: occurrences per project+source (excess rejected). */
	maxOccurrencesPerSource: 500_000,
} as const;

/** Rejected/dropped-item reason codes (never echo submitted values). */
export type ErrorIngestRejectReason =
	| "invalid-envelope"
	| "invalid-payload"
	| "invalid-timestamp"
	| "invalid-level"
	| "invalid-exception"
	| "too-large"
	| "unsupported-schema"
	| "invalid-context"
	| "invalid-breadcrumbs"
	| "invalid-id";
