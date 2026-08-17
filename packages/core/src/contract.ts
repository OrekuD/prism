/**
 * Frozen public contract for `@prism-analytics/core` (task-9 slice 1 + review
 * corrections, ADR 0002).
 *
 * This file is the review surface for the v2 analytics SDK contract. It is
 * NOT yet exported from the package index: slice 2 replaces the internal
 * implementation behind these declarations, and the contract tests in
 * `src/__tests__/contract.test.ts` currently FAIL on purpose (the runtime
 * implementation does not exist yet).
 *
 * Design rules (ADR 0002 §7):
 * - One options object; the factory resolves to a READY client.
 * - Discriminated unions for event variants and state machines; `readonly`
 *   observed state; explicit commands only.
 * - No DOM/Node/React globals — the runtime adapter is injected and defines
 *   its own minimal transport/storage/ID/time/scheduler/lifecycle seams.
 * - Invalid CALLER INPUT throws a specific validation error; consent,
 *   shutdown, and queue-capacity conditions return `dropped` results.
 * - Background delivery failures surface through diagnostics and rejected
 *   flush/shutdown promises; successful empty flushes stay quiet.
 */

/** JSON values accepted as event properties. */
export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };

/** Collection/consent state machine: `pending` → `granted` | `denied`. */
export type CollectionState = "pending" | "granted" | "denied";

/**
 * Where the anonymous identity may persist.
 * - `"session"`: kept for the lifetime of the runtime session (browser tab /
 *   app lifecycle), not across launches.
 * - `"persistent"`: survives launches; REQUIRES durable storage — the
 *   runtime adapter must provide `storage` or the factory rejects.
 * - `"none"`: no anonymous identity is stored anywhere.
 */
export type AnonymousPersistence = "none" | "session" | "persistent";

/** Reasons an event can be dropped without being queued. */
export type DropReason =
  | "consent-pending"
  | "consent-denied"
  | "queue-full"
  | "shutdown"
  | "invalid-user-id"
  | "invalid-traits";

/**
 * Discriminated result of every `track()` call. Delivery is never part of
 * the interaction's call stack — `queued` means accepted locally. Invalid
 * caller input (empty name, unserializable properties) THROWS instead of
 * returning a result; background delivery failures surface through
 * diagnostics and rejected flush/shutdown promises, not through track().
 */
export type CaptureResult =
  | { readonly status: "queued"; readonly eventId: string }
  | { readonly status: "dropped"; readonly reason: DropReason };

/** Minimal abort signal — structurally compatible with `AbortSignal`. */
export interface PrismSignal {
  readonly aborted: boolean;
  addEventListener(type: "abort", listener: () => void): void;
  removeEventListener(type: "abort", listener: () => void): void;
}

/** A single transport request (batch body). */
export interface PrismRequest {
  /** JSON-encoded batch body. */
  readonly body: string;
  /**
   * Request headers. The core supplies Prism authentication and content
   * type (`authorization: Bearer <sourceKey>`,
   * `content-type: application/json`); adapters forward these unchanged
   * and must never remove or log them. Adapters may add runtime-specific
   * safe headers but must not implement Prism authentication themselves.
   */
  readonly headers: Readonly<Record<string, string>>;
  /** Timeout for the request in milliseconds (from the queue options). */
  readonly timeoutMs: number;
  /** Cancellation signal — the transport should abort when fired. */
  readonly signal: PrismSignal;
}

/** A transport response. */
export interface PrismResponse {
  readonly status: number;
  /** Response headers, keys lower-cased (e.g. `retry-after`). */
  readonly headers: Readonly<Record<string, string>>;
  text(): Promise<string>;
}

/** Minimal transport seam — no DOM types in the core contract. */
export interface PrismTransport {
  /**
   * POST the batch to `url`; resolve with the response or reject on
   * network failure. `request.headers` carries Prism authentication —
   * adapters forward it unchanged.
   */
  post(url: string, request: PrismRequest): Promise<PrismResponse>;
}

/** Optional durable storage for queue persistence and persistent identity. */
export interface PrismStorage {
  /** Read a serialized value, or `null` when absent. */
  getItem(key: string): Promise<string | null>;
  /** Persist a serialized value. */
  setItem(key: string, value: string): Promise<void>;
  /** Remove a serialized value. */
  removeItem(key: string): Promise<void>;
}

/** Normalized runtime context (ADR 0002 §10) — capability-based, no UA parsing. */
export interface PrismRuntimeContext {
  /** e.g. `"browser"`, `"node"`, `"react-native"`. */
  readonly platform: string;
  /** e.g. `"web"`, `"server"`, `"mobile"`. */
  readonly kind: "web" | "server" | "mobile";
  readonly screenSize?: { readonly width: number; readonly height: number };
  readonly locale?: string;
  readonly timezone?: string;
  /** App version/build — required for mobile hosts later; optional in core. */
  readonly app?: { readonly name?: string; readonly version?: string; readonly build?: string };
  readonly device?: { readonly model?: string; readonly manufacturer?: string };
}

/** Lifecycle events a host can surface (browser fg/bg, before-unload, …). */
export type PrismLifecycleEvent = "foreground" | "background" | "before-unload";

/** Lifecycle subscription seam — the core never imports platform globals. */
export interface PrismLifecycle {
  /** Subscribe; returns an idempotent remove function. */
  on(event: PrismLifecycleEvent, listener: () => void): () => void;
}

/**
 * Runtime adapter seam. One implementation per host (browser, fake node,
 * fake native/mobile); the core never imports platform globals.
 */
export interface PrismRuntimeAdapter {
  /** Stable capability identifier, e.g. `"browser"`, `"node-fake"`. */
  readonly name: string;
  /** Epoch milliseconds. */
  now(): number;
  /** Unique identifier generator (crypto-random where available). */
  createId(): string;
  /** Transport for batch delivery. */
  readonly transport: PrismTransport;
  /** Optional durable queue/identity storage. */
  readonly storage?: PrismStorage;
  /** Scheduler/timer seam — schedule a callback after delayMs; returns cancel. */
  schedule(delayMs: number, callback: () => void): () => void;
  /** Normalized runtime context. */
  readonly context: PrismRuntimeContext;
  /** Lifecycle subscriptions (foreground/background/before-unload). */
  readonly lifecycle?: PrismLifecycle;
}

/** Queue/delivery tuning. All values optional with documented defaults. */
export interface PrismQueueOptions {
  /** Max queued events before new ones drop (`queue-full`). Default 1000. */
  maxQueueEvents?: number;
  /** Max total serialized queue bytes before new events drop. Default 1 MiB. */
  maxQueueBytes?: number;
  /** Max events per batch. Default 50. */
  maxBatchEvents?: number;
  /** Max serialized bytes per batch. Default 256 KiB. */
  maxBatchBytes?: number;
  /**
   * Max serialized bytes for a SINGLE event; larger events are dropped
   * (`queue-full`) so the SDK can never produce an event the ingestion
   * server rejects as oversized. Default 32 KiB (shared with the server
   * via `INGEST_LIMITS`).
   */
  maxEventBytes?: number;
  /** Per-request timeout in ms. Default 10_000. */
  requestTimeoutMs?: number;
  /** Interval between background batch flushes in ms. Default 10_000. */
  flushIntervalMs?: number;
  /**
   * Max delivery attempts per batch before it is abandoned (`batch_dropped`
   * diagnostic). Retries are automatic: exponential backoff from 1 s (×2
   * per attempt, ±20% deterministic jitter) capped at 60 s; a numeric
   * Retry-After header (seconds) is honored, capped at 60 s; HTTP-date
   * Retry-After falls back to exponential backoff. At most one retry is
   * pending at a time; the background interval remains the idle flush
   * driver. Default 5.
   */
  maxRetries?: number;
}

/** Options for `createPrismClient`. Every field is explicit — no positional args. */
export interface PrismClientOptions {
  /** Project analytics key (`pr_...`). */
  sourceKey: string;
  /** Ingestion origin chosen at runtime (hosted or self-hosted). Never compiled in. */
  endpoint: string;
  /** Host adapter: transport/storage/ID/time/scheduler/lifecycle. */
  runtime: PrismRuntimeAdapter;
  /** Privacy/collection configuration (ADR 0002 §5). */
  collection: {
    /** Initial state. `pending` never queues behavior silently. */
    initialState: CollectionState;
    /** Anonymous identity persistence policy. Default `"none"`. */
    anonymousPersistence?: AnonymousPersistence;
  };
  queue?: PrismQueueOptions;
  /**
   * Event-property sanitization (privacy). Matching keys are replaced with
   * the stable `[REDACTED]` marker, case-insensitively, at any depth; depth
   * and string limits are enforced with specific validation errors.
   */
  sanitize?: {
    /** Extra key names treated as credentials (case-insensitive matches). */
    denyList?: string[];
    /** Maximum property nesting depth. Default 12. */
    maxDepth?: number;
    /** Maximum string length for any property value. Default 10_000. */
    maxStringLength?: number;
  };
  /**
   * Optional diagnostic subscription made BEFORE the factory resolves, so
   * initialization diagnostics (queue restore/quarantine/purge) are
   * observable through the public API.
   */
  onDiagnostic?: (diagnostic: PrismDiagnostic) => void;
}

/** A diagnostic emitted by the client (delivery failures, state transitions). */
export interface PrismDiagnostic {
  readonly level: "debug" | "info" | "warn" | "error";
  /** Stable machine-readable code, e.g. `"delivery_failed"`. */
  readonly code: string;
  readonly message: string;
  readonly timestamp: number;
}

/** Idempotent diagnostic subscription handle. */
export interface PrismDiagnosticHandle {
  /** Remove the listener. Safe to call multiple times. */
  remove(): void;
}

/** A client-owned session lifecycle handle (ADR 0002 §3). */
export interface PrismSessionHandle {
  /** Client-generated, locally unique session ID. */
  readonly sessionId: string;
  /** Epoch milliseconds of `startSession`. */
  readonly startedAt: number;
  /**
   * End the session: emits the session-end event and returns its result.
   * The second call on the same handle returns `{ status: "not-active" }`.
   */
  end(): SessionEndResult;
}

/** Discriminated result of `startSession()`. */
export type SessionStartResult =
  | { readonly status: "started"; readonly session: PrismSessionHandle }
  | {
      readonly status: "blocked";
      readonly reason: "consent-pending" | "consent-denied" | "shutdown" | "already-active";
    };

/** Discriminated result of `PrismSessionHandle.end()`. */
export type SessionEndResult =
  | { readonly status: "ended"; readonly eventId: string }
  | { readonly status: "not-active" };

/**
 * The ready analytics client. All observed state is readonly; changes are
 * explicit commands.
 */
/**
 * Identity + global-property contract (task-10 §2). Terminology: person =
 * Prism's resolved analytics subject; userId = the customer's external
 * identifier; anonymousId = SDK-generated; traits = explicitly supplied
 * profile attributes.
 */
export type GlobalPropertyScope = "memory" | "session" | "persistent";

export type IdentifyResult =
  | {
      readonly status: "queued";
      readonly opId: string;
      readonly userId: string;
      readonly anonymousId: string;
    }
  | { readonly status: "dropped"; readonly reason: DropReason };

export type ResetResult =
  | { readonly status: "ok"; readonly anonymousId: string }
  | { readonly status: "blocked"; readonly reason: "shutdown" };

export type GlobalPropertyResult =
  | { readonly status: "ok" }
  | {
      readonly status: "blocked";
      readonly reason: "shutdown" | "storage-failure";
    };

export interface PrismIdentityState {
  /** The current SDK-generated anonymous identity (rotated on reset). */
  readonly anonymousId: string;
  /** The known external user ID after identify(), or null. */
  readonly userId: string | null;
  /** The last identify operation ID, or null. */
  readonly lastOpId: string | null;
}

/**
 * Identify operation carried in the batch envelope (wire v3). The project
 * is derived from the authenticated key; opId makes retries idempotent.
 */
export interface WireIdentifyOp {
  readonly opId: string;
  readonly userId: string;
  readonly anonymousId: string;
  readonly traits?: JsonObject;
  /** Trait keys to REMOVE (the reserved $unset convention, validated). */
  readonly unset?: readonly string[];
  readonly occurredAt: number;
}

/** v3 batch: adds optional identity operations; events may carry userId. */
export interface WireBatchV3 {
  readonly schemaVersion: 3;
  readonly sentAt: number;
  readonly sdk: { name: string; version: string };
  readonly identity?: readonly WireIdentifyOp[];
  readonly events: readonly WireEventV3[];
}

/** v3 event: the v2 event plus an optional developer-supplied userId. */
export interface WireEventV3 {
  readonly schemaVersion: 3;
  readonly eventId: string;
  readonly type: "track";
  readonly occurredAt: number;
  readonly sessionId?: string;
  readonly anonymousId?: string;
  readonly userId?: string;
  readonly name: string;
  readonly properties?: JsonObject;
  readonly context?: import("./limits").WireContext;
}

export interface PrismClient {
  readonly sourceKey: string;
  /** Ingestion origin chosen at runtime. */
  readonly endpoint: string;
  readonly runtime: PrismRuntimeAdapter;
  /** Current collection state (readonly; change via `setCollectionState`). */
  readonly collectionState: CollectionState;
  /** Active session handle, or `null` when sessionless. */
  readonly session: PrismSessionHandle | null;

  /**
   * Transition the collection state. Transitioning to `denied` clears all
   * queued analytics events, deletes the persistent anonymous identifier
   * (through the storage adapter), and closes any active session — nothing
   * queued before the withdrawal can be transmitted afterwards.
   * Transitioning back to `granted` starts a fresh anonymous context.
   * Resolves after the state change is applied.
   */
  setCollectionState(state: CollectionState): Promise<void>;

  /**
   * Validate, sanitize, assign a client-generated event ID, and enqueue.
   * Synchronous. Invalid caller input (empty/non-string name, properties
   * that are not JSON-serializable) THROWS a specific validation error;
   * consent/shutdown/queue-capacity conditions return a `dropped` result.
   * Delivery belongs to batching/flush, never to this call.
   */
  track(name: string, properties?: JsonObject): CaptureResult;

  /**
   * Start a client-owned session and return its handle (or a blocked
   * result when consent is not granted, the client is shut down, or a
   * session is already active). Sessionless callers (servers) may skip
   * this entirely.
   */
  startSession(options?: { properties?: JsonObject }): SessionStartResult;

  /**
   * Flush the queue: attempt delivery of all queued batches. Rejects when
   * the caller explicitly waits for delivery and it fails. A successful
   * flush of an empty queue is quiet — no diagnostics are emitted.
   */
  flush(): Promise<void>;

  /**
   * Idempotent shutdown: stop timers/listeners, attempt a bounded final
   * flush, then mark the client closed. Post-shutdown `track()` returns
   * `{ status: "dropped", reason: "shutdown" }`.
   */
  shutdown(options?: { timeoutMs?: number }): Promise<void>;

  /**
   * Link the current anonymous identity to a developer-supplied external
   * user ID (task-10). One ordered operation: queues the identify
   * operation (with optional traits) AND switches this client's known
   * identity so immediately-following track() calls attach to the new
   * context. ASYNC: resolves only after the state is committed locally
   * (queued + persisted when storage exists). Never merges two known
   * people; an already-linked anonymous context rotates for a different
   * userId. Repeated identical calls are idempotent (client-generated
   * operation IDs).
   */
  identify(userId: string, traits?: JsonObject): Promise<IdentifyResult>;

  /**
   * Logout/reset: closes the active session, clears the known identity,
   * ROTATES the anonymous ID, clears queued identify operations and ALL
   * global-property scopes (memory/session/persistent) — the next user
   * never inherits the previous user's context. Queued EVENTS keep their
   * immutable identity context. Works regardless of consent state.
   */
  reset(): Promise<ResetResult>;

  /**
   * Set a global property (merged under per-event properties; event
   * properties win for that event without mutating stored globals).
   * Scope: memory (default) | session | persistent. ASYNC because
   * persistent scope writes through the storage adapter.
   */
  setGlobalProperty(
    key: string,
    value: JsonValue,
    scope?: GlobalPropertyScope,
  ): Promise<GlobalPropertyResult>;

  /** Remove one global property in the given scope. */
  unsetGlobalProperty(key: string, scope?: GlobalPropertyScope): Promise<GlobalPropertyResult>;

  /** Clear every global property in the given scope (or all scopes). */
  clearGlobalProperties(scope?: GlobalPropertyScope): Promise<GlobalPropertyResult>;

  /** Current identity state (anonymous + known). */
  readonly identity: PrismIdentityState;

  /** Subscribe to diagnostics; returns an idempotent remove handle. */
  onDiagnostic(listener: (diagnostic: PrismDiagnostic) => void): PrismDiagnosticHandle;
}

/**
 * Async factory: validates options (project key, endpoint, runtime adapter,
 * and — for `anonymousPersistence: "persistent"` — durable storage), applies
 * the initial collection state, and resolves to a READY client. Rejects with
 * a specific `Error` for invalid configuration.
 *
 * Declared ambient on purpose during slice 1: the implementation replaces
 * the v1 internals in slice 2, and the contract tests fail until then.
 */
export declare function createPrismClient(options: PrismClientOptions): Promise<PrismClient>;
