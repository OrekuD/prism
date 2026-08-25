import type { JsonObject } from "./contract";

/**
 * Shared ingestion constants and the v2 wire envelope (task-9 §3, §8).
 *
 * ONE constants source: the SDK builds events within these limits and the
 * analytics API validates with the SAME limits, so an official-SDK event
 * can never be rejected as oversized (no poison-retry loop). Direct HTTP
 * clients are untrusted and are rejected at these ceilings.
 *
 * The §3 "suggested ceilings" are recorded here as the implemented values;
 * deviations (property-key and array-element ceilings deferred until the
 * SDK enforces them) are noted in tasks/task-9.md.
 */

/** Wire protocol major (ADR 0002 §2) — one envelope per endpoint major. */
export const WIRE_SCHEMA_VERSION = 3;
export type WireMobileSequence = number; // sessionSequence optional, bounded in queued event

/** SDK identity sent with every batch (batch-level, not per event). */
export const SDK_NAME = "@prism-analytics/core";
/** Keep in sync with packages/core/package.json version. */
export const SDK_VERSION = "0.0.1";

/** Centralized, tested ingestion limits (task-9 §3). */
export const INGEST_LIMITS = {
	/** One envelope version per endpoint major. */
	schemaVersion: WIRE_SCHEMA_VERSION,
	/** Max events per batch (matches the core queue default). */
	maxBatchEvents: 50,
	/** Max request bytes, enforced before parsing (512 KiB). */
	maxBatchBytes: 512 * 1024,
	/** Max serialized bytes per event (32 KiB) — enforced in core AND server. */
	maxEventBytes: 32 * 1024,
	/** Max event name length. */
	maxNameLength: 128,
	/** Max property nesting depth (matches the core sanitizer default). */
	maxPropertyDepth: 12,
	/** Max string length for any property value (core sanitizer default). */
	maxStringLength: 10_000,
	/** Max property keys per object (core AND server enforce). */
	maxPropertyKeys: 100,
	/** Max array elements (core AND server enforce). */
	maxArrayElements: 100,
	/** Max future clock skew accepted for occurredAt (5 minutes). */
	maxFutureSkewMs: 5 * 60_000,
	/** Max age accepted for occurredAt — bounded offline delivery (30 days). */
	maxPastAgeMs: 30 * 86_400_000,
} as const;

/**
 * Typed v2 context contract (task-9 slice-4 review F4): runtime-neutral
 * fields only — no browser/React Native/Node imports. The SDK fills this
 * from its injected runtime context; direct HTTP clients are validated
 * against the same strict JSON rules, redaction policy, and ceilings as
 * properties. SDK identity lives at BATCH level (ADR 0002 §2) — it is
 * never repeated per event, and server-stored SDK metadata is derived
 * from the validated batch (user context cannot override it).
 */
export interface WireContext {
	/** e.g. `"browser"`, `"node"`, `"react-native"`. */
	readonly platform?: string;
	readonly kind?: "web" | "server" | "mobile";
	readonly screenSize?: { readonly width: number; readonly height: number };
	readonly locale?: string;
	readonly timezone?: string;
	readonly app?: {
		readonly name?: string;
		readonly version?: string;
		readonly build?: string;
	};
	readonly device?: { readonly model?: string; readonly manufacturer?: string };
}

/** The v2 event envelope sent by the SDK (task-9 §3). */
export interface WireEnvelope {
	readonly schemaVersion: typeof WIRE_SCHEMA_VERSION;
	/** Client-generated, collision-resistant event ID (idempotency key). */
	readonly eventId: string;
	/** Event variant. Only `"track"` exists in this task; others reserved. */
	readonly type: "track";
	/** Epoch milliseconds when the action occurred (client clock). */
	readonly occurredAt: number;
	/** Client-owned session ID, when one was active. */
	readonly sessionId?: string;
	/** Anonymous identity, when configured. */
	readonly anonymousId?: string;
	/** Non-empty, ≤ 128 chars, no control characters. */
	readonly name: string;
	/** JSON-safe properties (sanitized on client and server). */
	readonly properties?: JsonObject;
	/** Normalized runtime context (typed, runtime-neutral). */
	readonly context?: WireContext;
}

/** The v2 batch envelope for POST /api/v2/ingest. */
export interface WireBatch {
	readonly schemaVersion: typeof WIRE_SCHEMA_VERSION;
	/** Epoch milliseconds when the SDK sent the batch. */
	readonly sentAt?: number;
	/** SDK identity (avoids repeating the same values per event). */
	readonly sdk?: { readonly name: string; readonly version: string };
	readonly events: readonly WireEnvelope[];
}

/** Per-event outcome, keyed by index and ID (never echoing properties). */
export type IngestStatus = "accepted" | "duplicate" | "rejected";

export interface IngestResult {
	/** Position of the event in the submitted batch. */
	readonly index: number;
	/** Client-generated event ID. */
	readonly id: string;
	readonly status: IngestStatus;
	/** Coarse reason code for rejected events only. */
	readonly reason?:
		| "invalid-name"
		| "invalid-properties"
		| "invalid-timestamp"
		| "unsupported-type"
		| "too-large"
		| "invalid-event"
		// Task 17: reserved page-view boundary rejections.
		| "page-view-requires-web-source"
		| "invalid-page-view"
		| "page-view-host-mismatch"
		// Task 18: reserved mobile boundary rejections.
		| "mobile-record-requires-react-native-source"
		| "mobile-record-requires-session"
		| "invalid-mobile-screen"
		| "invalid-mobile-lifecycle"
		| "mobile-digest-unconfigured"
		| "mobile-installation-required";
}

/** Success body for POST /api/v2/ingest (200). */
export interface IngestResponseBody {
	readonly ok: true;
	readonly results: readonly IngestResult[];
	/** Identity-operation outcomes (task-10 §4) — present when ops were submitted. */
	readonly identity?: readonly {
		readonly index: number;
		readonly opId: string;
		readonly status: "accepted" | "duplicate" | "rejected";
		readonly reason?: string;
	}[];
}
