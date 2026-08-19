/**
 * Frozen client-side error-report limits (task-15 slice 3).
 *
 * These mirror the analytics ingestion server's `ERROR_INGEST_LIMITS`
 * (slice 1) so the SDK can never produce an error item the server must
 * reject as oversized or malformed; the server re-validates regardless.
 * Values are hard protocol ceilings, never configurable upward.
 */
export const ERROR_LIMITS = {
	/** Max serialized batch body (matches the server's stream cap). */
	maxBatchBytes: 256 * 1024,
	/** Max error items per batch (matches the server). */
	maxErrorsPerBatch: 50,
	/** Exception chain depth (top exception = 1). */
	maxExceptionChain: 3,
	/** Max stack frames per exception (top first). */
	maxFramesPerException: 32,
	/** Max exception type length. */
	maxTypeLength: 128,
	/** Max message length (validated + truncated at this ceiling). */
	maxMessageLength: 512,
	/** Max URL/file length. */
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
	/** Max environment length. */
	maxEnvironmentLength: 64,
	/** Max client event id length (opaque ids). */
	maxClientEventIdLength: 128,
	/** Max anonymous id length (opaque ids). */
	maxAnonymousIdLength: 128,
	/** Max total serialized queue bytes before new reports drop. */
	maxQueueBytes: 512 * 1024,
} as const;
