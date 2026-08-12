/**
 * Frozen public contract for `@prism/core` (task-9 slice 1, ADR 0002).
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
 *   its own minimal transport/storage/ID/time seams.
 * - Invalid configuration throws during setup; background delivery failures
 *   surface through diagnostics and rejected flush/shutdown promises.
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
 * - `"none"`: no anonymous identity is stored anywhere.
 */
export type AnonymousPersistence = "none" | "session";

/** Reasons an event can be dropped without being queued. */
export type DropReason =
  | "consent-pending"
  | "consent-denied"
  | "invalid"
  | "queue-full"
  | "shutdown";

/**
 * Discriminated result of every `track()` call. Delivery is never part of
 * the interaction's call stack — `queued` means accepted locally.
 */
export type CaptureResult =
  | { readonly status: "queued"; readonly eventId: string }
  | { readonly status: "dropped"; readonly reason: DropReason }
  | {
      readonly status: "failed";
      readonly eventId: string;
      readonly error: unknown;
    };

/** Minimal transport seam — no DOM types in the core contract. */
export interface PrismTransport {
  /**
   * POST `body` (a JSON string) to `url`. Resolves with the response.
   * Implementations decide timeouts/abort; network errors should reject.
   */
  post(url: string, body: string, headers: Record<string, string>): Promise<{
    readonly status: number;
    text(): Promise<string>;
  }>;
}

/** Optional durable storage for queue persistence across reloads. */
export interface PrismStorage {
  /** Read a serialized value, or `null` when absent. */
  getItem(key: string): Promise<string | null>;
  /** Persist a serialized value. */
  setItem(key: string, value: string): Promise<void>;
  /** Remove a serialized value. */
  removeItem(key: string): Promise<void>;
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
  /** Optional durable queue storage. */
  readonly storage?: PrismStorage;
}

/** Queue/delivery tuning. All values are optional with documented defaults. */
export interface PrismQueueOptions {
  /** Max events held before the queue drops new ones (`queue-full`). Default 1000. */
  maxSize?: number;
  /** Interval between background batch flushes in ms. Default 10_000. */
  flushIntervalMs?: number;
  /** Max events per batch. Default 50. */
  maxBatchSize?: number;
  /** Max delivery attempts before a batch is abandoned (diagnostic only). Default 5. */
  maxRetries?: number;
}

/** Options for `createPrismClient`. Every field is explicit — no positional args. */
export interface PrismClientOptions {
  /** Project analytics key (`pr_...`). */
  projectKey: string;
  /** Ingestion origin chosen at runtime (hosted or self-hosted). Never compiled in. */
  endpoint: string;
  /** Host adapter: transport/storage/ID/time. */
  runtime: PrismRuntimeAdapter;
  /** Privacy/collection configuration (ADR 0002 §5). */
  collection: {
    /** Initial state. `pending` never queues behavior silently. */
    initialState: CollectionState;
    /** Anonymous identity persistence policy. Default `"none"`. */
    anonymousPersistence?: AnonymousPersistence;
  };
  queue?: PrismQueueOptions;
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
  /** End the session; emits the session-end event and returns its capture result. */
  end(): CaptureResult;
}

/**
 * The ready analytics client. All observed state is readonly; changes are
 * explicit commands.
 */
export interface PrismClient {
  readonly projectKey: string;
  /** Ingestion origin chosen at runtime. */
  readonly endpoint: string;
  readonly runtime: PrismRuntimeAdapter;
  /** Current collection state (readonly; change via `setCollectionState`). */
  readonly collectionState: CollectionState;
  /** Active session handle, or `null` when sessionless. */
  readonly session: PrismSessionHandle | null;

  /**
   * Transition the collection state. `granted`/`denied` are terminal until
   * changed again; `pending` never builds a hidden pre-consent queue.
   * Resolves after the state change is applied.
   */
  setCollectionState(state: CollectionState): Promise<void>;

  /**
   * Validate, sanitize, assign a client-generated event ID, and enqueue.
   * Synchronous; returns a discriminated result. Delivery belongs to
   * batching/flush, never to this call.
   */
  track(name: string, properties?: JsonObject): CaptureResult;

  /**
   * Start a client-owned session and return its handle. Sessionless callers
   * (servers) may skip this entirely.
   */
  startSession(options?: { properties?: JsonObject }): PrismSessionHandle;

  /**
   * Flush the queue: attempt delivery of all queued batches. Rejects when
   * the caller explicitly waits for delivery and it fails.
   */
  flush(): Promise<void>;

  /**
   * Idempotent shutdown: stop timers/listeners, attempt a bounded final
   * flush, then mark the client closed. Post-shutdown `track()` returns
   * `{ status: "dropped", reason: "shutdown" }`.
   */
  shutdown(options?: { timeoutMs?: number }): Promise<void>;

  /** Subscribe to diagnostics; returns an idempotent remove handle. */
  onDiagnostic(listener: (diagnostic: PrismDiagnostic) => void): PrismDiagnosticHandle;
}

/**
 * Async factory: validates options, applies the initial collection state,
 * and resolves to a READY client. Rejects with a specific `Error` for a
 * missing project key, a malformed endpoint, or a missing runtime adapter.
 *
 * Declared ambient on purpose during slice 1: the implementation replaces
 * the v1 internals in slice 2, and the contract tests fail until then.
 */
export declare function createPrismClient(options: PrismClientOptions): Promise<PrismClient>;
