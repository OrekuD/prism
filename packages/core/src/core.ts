import type {
  AnonymousPersistence,
  CaptureResult,
  CollectionState,
  JsonObject,
  PrismClient,
  PrismClientOptions,
  PrismDiagnostic,
  PrismDiagnosticHandle,
  PrismQueueOptions,
  PrismRuntimeAdapter,
  PrismRuntimeContext,
  PrismSessionHandle,
  PrismSignal,
  SessionEndResult,
  SessionStartResult,
} from "./contract";
import {
  INGEST_LIMITS,
  SDK_NAME,
  SDK_VERSION,
  WIRE_SCHEMA_VERSION,
  type WireContext,
  type WireEnvelope,
} from "./limits";
import { EventQueue, utf8Length, type QueuedEvent } from "./queue";
import {
  assertEndpoint,
  assertJsonSerializable,
  assertProjectKey,
  assertValidEventName,
  isValidEventName,
  sanitizeProperties,
  validateJsonValue,
} from "./validation";

const DEFAULT_QUEUE: Required<PrismQueueOptions> = {
  maxQueueEvents: 1000,
  maxQueueBytes: 1_048_576, // 1 MiB
  maxBatchEvents: 50,
  maxBatchBytes: 262_144, // 256 KiB
  maxEventBytes: INGEST_LIMITS.maxEventBytes, // 32 KiB — shared with the server
  requestTimeoutMs: 10_000,
  flushIntervalMs: 10_000,
  maxRetries: 5,
};

const ANONYMOUS_ID_KEY = "prism:anonymous_id";

// Retry policy (task-9 §6): exponential backoff with deterministic
// jitter for client-computed delays; a valid server Retry-After is a
// MINIMUM — never shortened, never jittered below, honored verbatim
// (delta-seconds and HTTP-date forms). At most one pending retry; the
// maxRetries bound closes the loop.
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;
/** Largest single timer interval setTimeout can represent (2^31 - 1 ms). */
const MAX_TIMER_MS = 2_147_483_647;

/** djb2 string hash — deterministic jitter without platform globals. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33) ^ value.charCodeAt(i);
  return hash >>> 0;
}

/**
 * Parse a Retry-After header (delta-seconds or HTTP-date) into a minimum
 * delay in milliseconds. Invalid, zero, or already-past instructions fall
 * back to client-computed exponential backoff (caller treats undefined as
 * such and emits a coarse diagnostic).
 */
function parseRetryAfterSeconds(
  header: string | undefined,
  now: number,
): number | undefined {
  if (!header) return undefined;
  const trimmed = header.trim();
  if (trimmed.length === 0) return undefined;
  const seconds = Number(trimmed);
  if (Number.isFinite(seconds) && seconds > 0) {
    return seconds * 1000;
  }
  // HTTP-date form (e.g. "Wed, 21 Oct 2015 07:28:00 GMT"). Date.parse is
  // a standard ECMAScript string parser (no runtime-specific global).
  const dateMs = Date.parse(trimmed);
  if (Number.isFinite(dateMs)) {
    const delay = dateMs - now;
    if (delay > 0) return delay;
  }
  return undefined;
}

/**
 * deliver() outcomes. Queue removal is ALWAYS the caller's job — doFlush()
 * is the single owner of queue mutation.
 */
type DeliverOutcome =
  | { readonly ok: true; readonly kind: "accepted" }
  | {
      readonly ok: true;
      readonly kind: "reconciled";
      readonly kept: QueuedEvent[];
      readonly rejected: number;
    }
  | { readonly ok: false; readonly error: unknown; readonly exhausted: boolean };

/** Internal abort-capable signal — structurally compatible with AbortSignal. */
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

/** Bound a promise with the runtime scheduler (no global setTimeout). */
function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  runtime: PrismRuntimeAdapter,
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cancel = runtime.schedule(timeoutMs, () => reject(new Error("timed out")));
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

class PrismClientImpl implements PrismClient {
  readonly projectKey: string;
  readonly endpoint: string;
  readonly runtime: PrismClientOptions["runtime"];

  private readonly queue: EventQueue;
  private readonly queueOptions: Required<PrismQueueOptions>;
  private readonly diagnostics = new Set<(d: PrismDiagnostic) => void>();
  private readonly persistence: AnonymousPersistence;
  private readonly denyList: string[];
  private readonly maxDepth: number;
  private readonly maxStringLength: number;
  private state: CollectionState;
  private operationGeneration = 0;
  private activeSession: SessionHandleImpl | null = null;
  private closed = false;
  /** Scope-neutral anonymous identity (any persistence mode). */
  private anonymousId: string | null = null;
  private flushPromise: Promise<void> | null = null;
  private inFlightSignal: AbortableSignal | null = null;
  private cancelTimer: (() => void) | null = null;
  private retryCancel: (() => void) | null = null;
  private attempts = new Map<string, number>();
  private queueRestored = false;
  private readonly lifecycleRemovers: Array<() => void> = [];
  private readonly instanceId: string;
  private readonly queueStorageKey: string;
  private readonly wireContext: WireContext;
  private persistChain: Promise<void> = Promise.resolve();

  constructor(options: PrismClientOptions) {
    assertProjectKey(options.projectKey);
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
      throw new Error("runtime adapter is required (transport, schedule, now, createId, context)");
    }
    if (
      options.collection.anonymousPersistence === "persistent" &&
      !runtime.storage
    ) {
      throw new Error("anonymousPersistence 'persistent' requires runtime.storage");
    }
    if (!["pending", "granted", "denied"].includes(options.collection.initialState)) {
      throw new Error("collection.initialState must be pending, granted, or denied");
    }
    // INGEST_LIMITS are hard protocol ceilings (task-9 slice-4 review F3):
    // a client configured above them could produce batches or events the
    // ingestion server must reject, causing permanent data loss.
    this.assertConfigWithinWireLimits(options.queue ?? {});

    this.projectKey = options.projectKey;
    this.endpoint = options.endpoint.replace(/\/$/, "");
    // The wire context is an ALLOWLISTED, validated, sanitized, frozen
    // snapshot built once at initialization (F16) — runtime context values
    // never cross the network unvalidated, and a later adapter mutation
    // cannot change what the SDK sends.
    this.wireContext = this.allowlistContext(runtime.context);
    // Queue persistence is namespaced per PROJECT (a reload of the same
    // execution context restores its queue). Tradeoff recorded (task-9 §6):
    // two tabs sharing the project key overwrite each other's snapshot —
    // server-side dedup by eventId covers the overlap, and the browser
    // adapter implements a storage lease in its slice.
    this.instanceId = runtime.createId();
    // Storage namespaces carry BOTH endpoint and project identity (§15):
    // an endpoint change (hosted → self-hosted, instance migration) must
    // NEVER silently deliver a persisted queue to the new instance. The
    // endpoint origin is hashed (deterministic, no URL in storage keys).
    this.queueStorageKey = `prism:queue:v2:${hashString(
      options.endpoint,
    )}:${this.projectKey}`;
    this.runtime = runtime;
    this.state = options.collection.initialState;
    this.persistence = options.collection.anonymousPersistence ?? "none";
    this.queueOptions = { ...DEFAULT_QUEUE, ...options.queue };
    this.denyList = options.sanitize?.denyList ?? [];
    this.maxDepth = options.sanitize?.maxDepth ?? 12;
    this.maxStringLength = options.sanitize?.maxStringLength ?? 10_000;
    this.queue = new EventQueue({
      maxEvents: this.queueOptions.maxQueueEvents,
      maxBytes: this.queueOptions.maxQueueBytes,
      maxEventBytes: this.queueOptions.maxEventBytes,
    });

    // Background delivery loop — self-rescheduling through the runtime seam.
    const interval = this.queueOptions.flushIntervalMs;
    const loop = async (): Promise<void> => {
      if (this.closed) return;
      await this.tick();
      if (this.closed) return;
      this.cancelTimer = runtime.schedule(interval, loop);
    };
    this.cancelTimer = runtime.schedule(interval, loop);

    // Best-effort flush before the host goes away (adapter-owned lifecycle).
    if (runtime.lifecycle) {
      this.lifecycleRemovers.push(
        runtime.lifecycle.on("before-unload", () => {
          void this.tick();
        }),
      );
    }
  }

  /** Called by the factory before resolving — the client is fully ready. */
  async ready(): Promise<void> {
    await this.restoreQueueState();
    await this.ensureAnonymousIdentity();
  }

  /** Readonly observed collection state. */
  get collectionState(): CollectionState {
    return this.state;
  }

  get session(): PrismSessionHandle | null {
    return this.activeSession;
  }

  async setCollectionState(state: CollectionState): Promise<void> {
    if (state !== "pending" && state !== "granted" && state !== "denied") {
      // Invalid caller input throws (contract rule) — nothing changes, so
      // an unknown state can never enable collection.
      throw new Error("collection state must be pending, granted, or denied");
    }
    // Every transition advances the operation generation: any in-flight
    // flush observes the change before it can mutate the queue again (F15).
    this.operationGeneration += 1;
    this.state = state;
    if (state === "denied") {
      // Consent withdrawal: nothing queued before the withdrawal may be
      // transmitted, the anonymous identity is deleted, the session closes,
      // and any in-flight delivery request is cancelled.
      this.queue.clear();
      void this.persistQueue();
      this.anonymousId = null;
      this.activeSession = null;
      this.inFlightSignal?.abort();
      this.cancelRetry();
      await this.runtime.storage?.removeItem(ANONYMOUS_ID_KEY);
    }
    if (state === "granted") {
      // A queue snapshot deferred under pending is restored on grant.
      await this.restoreQueueState();
      await this.ensureAnonymousIdentity();
    }
  }

  track(name: string, properties?: JsonObject): CaptureResult {
    assertValidEventName(name);
    const sanitized = this.validateAndSanitize(properties);

    if (this.closed) {
      return { status: "dropped", reason: "shutdown" };
    }
    if (this.state === "pending") {
      return { status: "dropped", reason: "consent-pending" };
    }
    if (this.state === "denied") {
      return { status: "dropped", reason: "consent-denied" };
    }

    const event: QueuedEvent = this.buildEvent(name, sanitized);
    if (!this.queue.enqueue(event)) {
      return { status: "dropped", reason: "queue-full" };
    }
    void this.afterEnqueue();
    return { status: "queued", eventId: event.eventId };
  }

  startSession(options?: { properties?: JsonObject }): SessionStartResult {
    if (this.closed) {
      return { status: "blocked", reason: "shutdown" };
    }
    if (this.state === "pending") {
      return { status: "blocked", reason: "consent-pending" };
    }
    if (this.state === "denied") {
      return { status: "blocked", reason: "consent-denied" };
    }
    if (this.activeSession) {
      return { status: "blocked", reason: "already-active" };
    }
    // Validate BEFORE creating the handle: a rejected property tree must
    // never leave a ghost active session behind (F19).
    const properties = this.validateAndSanitize(options?.properties);
    const handle = new SessionHandleImpl(
      this.runtime.createId(),
      this.runtime.now(),
      (handleRef) => this.endSession(handleRef),
    );
    this.activeSession = handle;
    // The session-start event carries the session ID; if the queue is full
    // the session still exists locally (delivery is best-effort).
    this.queue.enqueue(this.buildEvent("session_started", properties, handle.sessionId));
    void this.afterEnqueue();
    return { status: "started", session: handle };
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
    for (const remove of this.lifecycleRemovers) remove();
    this.lifecycleRemovers.length = 0;

    // Abort any in-flight BACKGROUND flush so it fails fast; the final
    // flush below uses a fresh signal. One deadline bounds the ENTIRE
    // operation — a transport that ignores cancellation cannot hang
    // shutdown.
    this.inFlightSignal?.abort();
    this.cancelRetry();
    const timeoutMs = options?.timeoutMs ?? 10_000;
    try {
      await withTimeout(this.drainQueue(), timeoutMs, this.runtime);
    } catch {
      this.emit("warn", "shutdown_flush_failed", "final flush did not complete");
    }
    // The final attempt may have scheduled a retry — cancel it.
    this.cancelRetry();
    // Deterministic final snapshot: mutation-time writes plus an explicit
    // close-out write, so a successful final delivery persists the empty
    // queue and the next client never replays delivered events.
    void this.persistQueue();
    await this.persistChain.catch(() => undefined);
  }

  private assertConfigWithinWireLimits(queue: PrismQueueOptions): void {
    // Every queue value must be a finite positive integer (F20): zero,
    // negative, fractional, NaN, and infinite values wedge delivery or
    // break byte accounting.
    const OPTIONS = [
      "maxQueueEvents",
      "maxQueueBytes",
      "maxBatchEvents",
      "maxBatchBytes",
      "maxEventBytes",
      "requestTimeoutMs",
      "flushIntervalMs",
      "maxRetries",
    ] as const;
    for (const key of OPTIONS) {
      const value = queue[key] as number | undefined;
      if (value !== undefined && (!Number.isInteger(value) || value <= 0)) {
        throw new Error(`${key} must be a finite positive integer (got ${value})`);
      }
    }
    const ceiling = (label: string, value: number | undefined, max: number): void => {
      if (value !== undefined && value > max) {
        throw new Error(`${label} ${value} exceeds the wire ceiling (${max})`);
      }
    };
    ceiling("maxBatchEvents", queue.maxBatchEvents, INGEST_LIMITS.maxBatchEvents);
    ceiling("maxBatchBytes", queue.maxBatchBytes, INGEST_LIMITS.maxBatchBytes);
    ceiling("maxEventBytes", queue.maxEventBytes, INGEST_LIMITS.maxEventBytes);
  }

  /**
   * Persist the mutation, then request delivery when the batch threshold
   * is reached. Coalesced through the single in-flight flush promise;
   * consent/shutdown gating lives in track() and doFlush().
   */
  private afterEnqueue(): void {
    void this.persistQueue();
    const reached =
      this.queue.size >= this.queueOptions.maxBatchEvents ||
      this.queue.bytes >= this.queueOptions.maxBatchBytes;
    if (reached) {
      void this.flush().catch(() => {
        // Failure surfaces via diagnostics and flush rejection.
      });
    }
  }

  /**
   * Allowlisted WireContext (F16): picks ONLY the typed runtime-neutral
   * fields, validates the result as strict JSON, applies the credential
   * redaction policy, and freezes the snapshot. Invalid adapter input is
   * a configuration error (specific message), never silent data loss or a
   * delivery-time JSON crash.
   */
  private allowlistContext(context: PrismRuntimeContext): WireContext {
    const picked: {
      platform?: string;
      kind?: "web" | "server" | "mobile";
      screenSize?: { width: number; height: number };
      locale?: string;
      timezone?: string;
      app?: { name?: string; version?: string; build?: string };
      device?: { model?: string; manufacturer?: string };
    } = {};
    if (typeof context.platform === "string" && context.platform.length > 0) {
      picked.platform = context.platform;
    }
    if (context.kind === "web" || context.kind === "server" || context.kind === "mobile") {
      picked.kind = context.kind;
    }
    if (
      context.screenSize &&
      Number.isFinite(context.screenSize.width) &&
      Number.isFinite(context.screenSize.height)
    ) {
      picked.screenSize = { width: context.screenSize.width, height: context.screenSize.height };
    }
    if (typeof context.locale === "string" && context.locale.length > 0) {
      picked.locale = context.locale;
    }
    if (typeof context.timezone === "string" && context.timezone.length > 0) {
      picked.timezone = context.timezone;
    }
    if (context.app) {
      const app: { name?: string; version?: string; build?: string } = {};
      if (typeof context.app.name === "string") app.name = context.app.name;
      if (typeof context.app.version === "string") app.version = context.app.version;
      if (typeof context.app.build === "string") app.build = context.app.build;
      if (Object.keys(app).length > 0) picked.app = app;
    }
    if (context.device) {
      const device: { model?: string; manufacturer?: string } = {};
      if (typeof context.device.model === "string") device.model = context.device.model;
      if (typeof context.device.manufacturer === "string") {
        device.manufacturer = context.device.manufacturer;
      }
      if (Object.keys(device).length > 0) picked.device = device;
    }
    const validation = validateJsonValue(picked, {
      maxDepth: INGEST_LIMITS.maxPropertyDepth,
      maxStringLength: INGEST_LIMITS.maxStringLength,
      maxKeys: INGEST_LIMITS.maxPropertyKeys,
      maxArrayElements: INGEST_LIMITS.maxArrayElements,
    });
    if (!validation.ok) {
      throw new Error(`runtime context is not JSON-safe (${validation.reason})`);
    }
    const sanitized = sanitizeProperties(picked as JsonObject, {
      maxDepth: INGEST_LIMITS.maxPropertyDepth,
      maxStringLength: INGEST_LIMITS.maxStringLength,
    }) as WireContext;
    return Object.freeze(sanitized);
  }

  private cancelRetry(): void {
    if (this.retryCancel !== null) {
      this.retryCancel();
      this.retryCancel = null;
    }
  }

  /** Settle the in-flight flush (if any), then deliver what remains. */
  private async drainQueue(): Promise<void> {
    if (this.flushPromise) {
      try {
        await this.flushPromise;
      } catch {
        // The in-flight failure was surfaced via diagnostics; cancellation
        // never counts toward retry exhaustion, so the batch is preserved.
      }
    }
    if (!this.queue.isEmpty) {
      await this.flush();
    }
  }

  onDiagnostic(listener: (diagnostic: PrismDiagnostic) => void): PrismDiagnosticHandle {
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

  // ---- internals ----

  private async tick(): Promise<void> {
    if (this.closed || this.queue.isEmpty) return;
    try {
      await this.flush();
    } catch {
      // The failure was already surfaced via flush rejection + diagnostic.
    }
  }

  /**
   * THE single owner of queue removal: batches leave the queue here and
   * only here — on success, on per-event reconciliation, on permanent
   * rejection, and on retry exhaustion. deliver() never mutates the queue.
   */
  private async doFlush(): Promise<void> {
    // Consent gate: pending/denied never transmit — restored events and
    // explicit, background, retry, and shutdown flushes are all covered.
    if (this.state !== "granted") return;
    const generation = this.operationGeneration;
    while (!this.queue.isEmpty) {
      // Recheck before EVERY iteration AND after every awaited delivery:
      // a transport that ignores cancellation can complete while consent
      // is already denied — its result must never requeue events or start
      // another request (F15).
      if (this.state !== "granted" || generation !== this.operationGeneration) {
        return;
      }
      const batch = this.queue.peekBatch(
        this.queueOptions.maxBatchEvents,
        this.queueOptions.maxBatchBytes,
      );
      if (batch.length === 0) break;
      const signal = createSignal();
      this.inFlightSignal = signal;
      let outcome: Awaited<ReturnType<PrismClientImpl["deliver"]>>;
      try {
        outcome = await this.deliver(batch, signal);
      } finally {
        if (this.inFlightSignal === signal) this.inFlightSignal = null;
      }
      // Post-await recheck BEFORE any queue mutation: withdrawal cleared
      // the queue while the request was in flight — removing or
      // requeueing anything now would resurrect delivered events or start
      // another request under denial.
      if (this.state !== "granted" || generation !== this.operationGeneration) {
        return;
      }
      if (!outcome.ok) {
        if (outcome.exhausted) {
          this.queue.removeFirst(batch.length);
          void this.persistQueue();
        }
        throw outcome.error;
      }
      this.queue.removeFirst(batch.length);
      if (outcome.kind === "reconciled" && outcome.kept.length > 0) {
        this.queue.requeueAtHead(outcome.kept);
      }
      this.attempts.delete(batch[0]?.eventId ?? "");
      void this.persistQueue();
    }
  }

  /**
   * Build the immutable event. The serialized form IS the v2 wire envelope
   * (task-9 §3): schemaVersion/eventId/type/occurredAt, optional
   * sessionId/anonymousId, the track name + properties, and normalized
   * runtime context. `timestamp`/`sessionId` on the internal QueuedEvent
   * mirror the envelope for queue accounting and session semantics.
   */
  /**
   * ONE strict-JSON validation + sanitization path (F19): every property
   * tree the SDK accepts (track AND session events) passes through this.
   * Validation is iterative and never uses stringify as a validator.
   */
  private validateAndSanitize(properties?: JsonObject): JsonObject {
    assertJsonSerializable(properties);
    return sanitizeProperties(properties ?? {}, {
      denyList: this.denyList,
      maxDepth: this.maxDepth,
      maxStringLength: this.maxStringLength,
    });
  }

  private buildEvent(name: string, properties?: JsonObject, sessionId?: string): QueuedEvent {
    const eventId = this.runtime.createId();
    const resolvedSessionId = sessionId ?? this.activeSession?.sessionId;
    const now = this.runtime.now();
    // Context is the allowlisted, validated, sanitized snapshot (F16).
    // SDK identity is batch-level only (F13) — never duplicated per event.
    const context = this.wireContext;
    const envelope: WireEnvelope = {
      schemaVersion: WIRE_SCHEMA_VERSION,
      eventId,
      type: "track",
      occurredAt: now,
      sessionId: resolvedSessionId,
      anonymousId: this.anonymousId ?? undefined,
      name,
      properties,
      context,
    };
    const serialized = JSON.stringify(envelope);
    return {
      owner: this.instanceId,
      eventId,
      name,
      properties,
      timestamp: now,
      sessionId: resolvedSessionId,
      serialized,
    };
  }

  private async deliver(
    batch: QueuedEvent[],
    signal: AbortableSignal,
  ): Promise<DeliverOutcome> {
    const request = {
      // The v2 batch envelope (task-9 §8): SDK identity at batch level so
      // identical values are not repeated per event.
      body: JSON.stringify({
        schemaVersion: WIRE_SCHEMA_VERSION,
        sentAt: this.runtime.now(),
        sdk: { name: SDK_NAME, version: SDK_VERSION },
        events: batch.map((e) => JSON.parse(e.serialized)),
      }),
      // Authentication is part of the transport contract (F1): the core
      // owns Prism authentication semantics; adapters forward these
      // headers unchanged and never log them. The project key never
      // appears in diagnostics or error messages.
      headers: {
        authorization: `Bearer ${this.projectKey}`,
        "content-type": "application/json",
      },
      timeoutMs: this.queueOptions.requestTimeoutMs,
      signal,
    };
    let response;
    try {
      response = await this.runtime.transport.post(`${this.endpoint}/api/v2/ingest`, request);
    } catch (error) {
      if (signal.aborted) {
        // Intentional cancellation (consent withdrawal / shutdown): never
        // counts toward retry exhaustion and never drops the batch — the
        // fresh final attempt delivers it.
        this.emit("warn", "delivery_cancelled", "in-flight delivery cancelled");
        return { ok: false, error: new Error("batch delivery cancelled"), exhausted: false };
      }
      // Coarse SDK-owned error (F17): arbitrary transport error text may
      // embed the authorization header (the project key) — it must never
      // cross the public API through rejected flushes or diagnostics.
      const coarse = new Error("batch delivery failed");
      const exhausted = this.handleFailure(batch, coarse);
      return { ok: false, error: coarse, exhausted };
    }
    if (response.status >= 200 && response.status < 300) {
      const reconciled = await this.reconcileResults(batch, response);
      if (reconciled === "malformed") {
        // Cannot trust the accounting — retry (server-side dedup by
        // eventId makes a resend safe).
        const error = new Error("ingest returned malformed batch results");
        const exhausted = this.handleFailure(batch, error);
        return { ok: false, error, exhausted };
      }
      if (reconciled === null) {
        // No results body: status-only success — the whole batch is done.
        return { ok: true, kind: "accepted" };
      }
      if (reconciled.rejected > 0) {
        this.emit(
          "warn",
          "event_rejected",
          `${reconciled.rejected} event(s) rejected by the server`,
        );
      }
      return {
        ok: true,
        kind: "reconciled",
        kept: reconciled.kept,
        rejected: reconciled.rejected,
      };
    }
    // Permanent client errors are not retried: the batch leaves the queue
    // with a remediation diagnostic (never exposing the key or event body).
    if (
      response.status === 400 ||
      response.status === 401 ||
      response.status === 403 ||
      response.status === 413
    ) {
      this.emit(
        "error",
        "batch_rejected",
        `ingest rejected the batch (${response.status}) — fix the event payload; it will not be retried`,
      );
      return { ok: true, kind: "accepted" };
    }
    const error = new Error(`ingest responded ${response.status}`);
    const retryAfterMs = parseRetryAfterSeconds(
      response.headers["retry-after"],
      this.runtime.now(),
    );
    this.emit(
      "warn",
      "rate_limited",
      `ingest responded ${response.status}${
        retryAfterMs !== undefined
          ? ` (retry-after ${Math.round(retryAfterMs / 1000)}s)`
          : " (no valid retry-after; using backoff)"
      }`,
    );
    const exhausted = this.handleFailure(batch, error, retryAfterMs);
    return { ok: false, error, exhausted };
  }

  /**
   * Counts the attempt, schedules the bounded retry loop, and reports
   * exhaustion. Removal on exhaustion is doFlush's job (single owner).
   */
  private handleFailure(batch: QueuedEvent[], error: unknown, retryAfterMs?: number): boolean {
    const key = batch[0]?.eventId ?? "unknown";
    const attempts = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempts);
    // Coarse diagnostic only — never String(error) text (F17).
    this.emit("warn", "delivery_failed", "batch delivery failed");
    if (attempts >= this.queueOptions.maxRetries) {
      this.attempts.delete(key);
      this.emit("error", "batch_dropped", `batch dropped after ${attempts} failed attempts`);
      return true;
    }
    this.scheduleRetry(attempts, retryAfterMs);
    return false;
  }

  /**
   * Automatic retry loop (task-9 §6, slice-4 review F9):
   * - Client-computed delays: exponential backoff from 1 s (×2 per
   *   attempt, ±20% deterministic jitter), capped at 60 s.
   * - Server-provided Retry-After is a MINIMUM: honored verbatim (no
   *   cap, no jitter below it — jitter is never applied to it).
   * - Delays beyond the scheduler's maximum timer interval are
   *   rescheduled in safe chunks so Prism never sends early.
   * At most one retry is pending at a time; maxRetries bounds the loop.
   */
  private scheduleRetry(attempt: number, retryAfterMs?: number): void {
    if (this.retryCancel || this.closed) return;
    let cancelled = false;
    let activeCancel: (() => void) | null = null;
    // The cancel handle retains the ACTIVE scheduler cancellation (F21):
    // invoking it clears the pending timer so long retries cannot keep a
    // Node process or mobile runtime alive.
    this.retryCancel = () => {
      cancelled = true;
      activeCancel?.();
      activeCancel = null;
    };
    const exponential = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
    const jitter = 0.8 + (0.4 * (hashString(String(exponential)) % 1000)) / 1000;
    const delayMs =
      retryAfterMs !== undefined ? retryAfterMs : Math.max(1, Math.round(exponential * jitter));
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
    this.emit("debug", "retry_scheduled", `retry ${attempt} scheduled in ${delayMs} ms`);
  }

  /** Ends ONLY the session that owns the calling handle. */
  private endSession(handle: SessionHandleImpl): SessionEndResult {
    if (this.activeSession !== handle) {
      return { status: "not-active" };
    }
    this.activeSession = null;
    const event = this.buildEvent("session_ended", undefined, handle.sessionId);
    const queued = this.queue.enqueue(event);
    if (!queued) {
      this.emit("warn", "session_end_dropped", "session-end event was not queued");
    } else {
      void this.afterEnqueue();
    }
    return { status: "ended", eventId: event.eventId };
  }

  /**
   * Queue snapshot through the injected storage adapter. Writes are
   * serialized on a chain so the final state is deterministic (the last
   * write reflects the last queue mutation).
   */
  private persistQueue(): Promise<void> {
    const storage = this.runtime.storage;
    if (!storage) return Promise.resolve();
    this.persistChain = this.persistChain
      .then(async () => {
        // Owner-segmented merge (release review): the snapshot keeps ONE
        // segment per execution context (owner = instanceId). Persisting
        // replaces THIS context's segment while PRESERVING the other
        // contexts' segments — a co-writing context never erases the
        // other's queued events, and this context's delivered events stay
        // removed (they left its segment). Segments share the same
        // endpoint+project namespace, so either context may safely
        // deliver any segment (server dedup makes overlaps idempotent).
        const current = this.queue.snapshot().map((event) => ({
          owner: event.owner,
          eventId: event.eventId,
          name: event.name,
          occurredAt: event.timestamp,
          serialized: event.serialized,
        }));
        let merged = current;
        try {
          const raw = await storage.getItem(this.queueStorageKey);
          if (raw) {
            const parsed = JSON.parse(raw) as { v?: number; events?: unknown };
            if (parsed?.v === 3 && Array.isArray(parsed.events)) {
              // Keep only OTHER contexts' segments — this context's old
              // segment is fully replaced by `current` (delivered events
              // stay removed), and tombstoned IDs (delivered or consent-
              // purged anywhere in this context) never resurrect.
              const tombstones = this.queue.recentlyRemovedIds();
              const others = (parsed.events as Array<{ owner?: string; eventId?: string }>).filter(
                (entry) =>
                  typeof entry.owner === "string" &&
                  entry.owner !== this.instanceId &&
                  typeof entry.eventId === "string" &&
                  !tombstones.has(entry.eventId),
              );
              merged = [...others, ...current] as typeof current;
            }
          }
        } catch {
          // unreadable snapshot — write the current queue as-is
        }
        await storage.setItem(this.queueStorageKey, JSON.stringify({ v: 3, events: merged }));
      })
      .catch(() => {
        this.emit("warn", "queue_persist_failed", "could not persist the queue");
      });
    return this.persistChain;
  }

  /**
   * Restore the persisted queue (slice-4 review F10). The persisted
   * snapshot has an EXACT schema separate from the wire envelope:
   *
   *   { v: 2, events: [{ eventId, name, occurredAt, serialized }] }
   *
   * Every entry is validated with the SAME v2 event rules used for newly
   * captured events (name rules, strict JSON properties, size ceilings,
   * timestamp window, field agreement) plus unknown-field rejection. Any
   * doubt about any entry quarantines the ENTIRE snapshot with one coarse
   * diagnostic — partial restoration is never attempted, and the
   * pre-v2 format is not supported (no production users; no migration).
   * Consent-aware: granted restores once; pending defers; denied purges
   * without parsing.
   */
  private async restoreQueueState(): Promise<void> {
    const storage = this.runtime.storage;
    if (!storage) return;
    if (this.state !== "granted") {
      if (this.state === "denied") {
        await storage.removeItem(this.queueStorageKey).catch(() => undefined);
        this.emit(
          "warn",
          "queue_state_purged",
          "persisted queue purged on consent denial",
        );
      }
      return;
    }
    if (this.queueRestored) return;
    const raw = await storage.getItem(this.queueStorageKey).catch(() => null);
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw) as { v?: unknown; events?: unknown };
      if (parsed?.v !== 3 || !Array.isArray(parsed.events)) {
        throw new Error("unsupported queue state version");
      }
      for (const entry of parsed.events as unknown[]) {
        this.validatePersistedEntry(entry);
      }
      const adoptedIds: string[] = [];
      for (const entry of parsed.events as unknown[]) {
        const e = entry as {
          owner: string;
          eventId: string;
          name: string;
          occurredAt: number;
          serialized: string;
        };
        const envelope = JSON.parse(e.serialized) as WireEnvelope;
        // Adoption: this context takes ownership of the restored event —
        // it delivers it and its segment replaces the stale stored copy.
        adoptedIds.push(e.eventId);
        this.queue.enqueue({
          owner: this.instanceId,
          eventId: e.eventId,
          name: e.name,
          properties: envelope.properties,
          timestamp: e.occurredAt,
          sessionId: envelope.sessionId,
          serialized: e.serialized,
        });
      }
      // The adopted IDs tombstone the OTHER contexts' stale copies so the
      // next persist keeps exactly one copy per event.
      this.queue.tombstoneIds(adoptedIds);
      this.queueRestored = true;
      if (this.queue.size > 0) {
        this.emit(
          "info",
          "queue_restored",
          `restored ${this.queue.size} queued event(s)`,
        );
      }
    } catch {
      this.queueRestored = true;
      this.queue.clear();
      await storage.removeItem(this.queueStorageKey).catch(() => undefined);
      this.emit(
        "warn",
        "queue_state_reset",
        "corrupt or future queue state quarantined and cleared",
      );
    }
  }

  /**
   * Validate ONE persisted entry. Throws on ANY suspicion so the whole
   * snapshot is quarantined by the caller (F10).
   */
  private validatePersistedEntry(entry: unknown): void {
    if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
      throw new Error("corrupt queue entry");
    }
    const record = entry as Record<string, unknown>;
    const expectedKeys = ["owner", "eventId", "name", "occurredAt", "serialized"];
    if (Object.keys(record).length !== expectedKeys.length) {
      throw new Error("queue entry has unknown fields");
    }
    for (const key of expectedKeys) {
      if (!(key in record)) throw new Error("queue entry is missing fields");
    }
    const { owner, eventId, name, occurredAt, serialized } = record;
    if (typeof owner !== "string" || owner.length === 0 || owner.length > 128) {
      throw new Error("queue entry has an invalid owner");
    }
    if (typeof eventId !== "string" || eventId.length === 0 || eventId.length > 128) {
      throw new Error("queue entry has an invalid event id");
    }
    if (!isValidEventName(name)) {
      throw new Error("queue entry has an invalid event name");
    }
    if (typeof occurredAt !== "number" || !Number.isFinite(occurredAt)) {
      throw new Error("queue entry has an invalid timestamp");
    }
    // Events outside the server's accepted window can never be delivered
    // (the ingestion service rejects them) — purge them at restore instead
    // of poisoning the retry loop.
    const now = this.runtime.now();
    if (
      occurredAt > now + INGEST_LIMITS.maxFutureSkewMs ||
      occurredAt < now - INGEST_LIMITS.maxPastAgeMs
    ) {
      throw new Error("queue entry is outside the delivery window");
    }
    if (typeof serialized !== "string" || utf8Length(serialized) > INGEST_LIMITS.maxEventBytes) {
      throw new Error("queue entry exceeds the event size ceiling");
    }
    let envelope: WireEnvelope;
    try {
      envelope = JSON.parse(serialized) as WireEnvelope;
    } catch {
      throw new Error("queue entry has an unparsable envelope");
    }
    if (
      envelope.schemaVersion !== WIRE_SCHEMA_VERSION ||
      envelope.eventId !== eventId ||
      envelope.name !== name ||
      envelope.occurredAt !== occurredAt ||
      envelope.type !== "track"
    ) {
      throw new Error("queue entry fields disagree with the envelope");
    }
    if (envelope.properties !== undefined) {
      const result = validateJsonValue(envelope.properties, {
        maxDepth: INGEST_LIMITS.maxPropertyDepth,
        maxStringLength: INGEST_LIMITS.maxStringLength,
        maxKeys: INGEST_LIMITS.maxPropertyKeys,
        maxArrayElements: INGEST_LIMITS.maxArrayElements,
      });
      if (!result.ok) {
        throw new Error(`queue entry has invalid properties (${result.reason})`);
      }
    }
    if (envelope.context !== undefined) {
      const result = validateJsonValue(envelope.context, {
        maxDepth: INGEST_LIMITS.maxPropertyDepth,
        maxStringLength: INGEST_LIMITS.maxStringLength,
        maxKeys: INGEST_LIMITS.maxPropertyKeys,
        maxArrayElements: INGEST_LIMITS.maxArrayElements,
      });
      if (!result.ok) {
        throw new Error(`queue entry has invalid context (${result.reason})`);
      }
    }
  }

  /**
   * Strict per-event reconciliation (the v2 ingest contract): a 2xx with a
   * `results` array is trusted only when every entry has a string id and a
   * known status and no id repeats. Only SUBMITTED ids with a terminal
   * status (accepted/duplicate/rejected) leave the queue; missing results,
   * unknown statuses, and unrelated ids keep their events queued
   * (retried through the bounded retry loop — server-side dedup by
   * eventId makes resends safe). A body without `results` accepts the
   * whole batch (status-only success). `"malformed"` rejects the batch
   * retryably when the accounting cannot be trusted.
   */
  private async reconcileResults(
    batch: QueuedEvent[],
    response: { text(): Promise<string> },
  ): Promise<{ kept: QueuedEvent[]; rejected: number } | "malformed" | null> {
    let body: { results?: unknown };
    try {
      body = JSON.parse(await response.text()) as { results?: unknown };
    } catch {
      return null; // non-JSON body: status-only success
    }
    if (!Array.isArray(body.results)) return null;
    const terminal = new Set<string>();
    const seen = new Set<string>();
    let rejected = 0;
    for (const entry of body.results) {
      const result = entry as { id?: unknown; status?: unknown } | null;
      if (!result || typeof result.id !== "string" || typeof result.status !== "string") {
        return "malformed";
      }
      if (seen.has(result.id)) return "malformed"; // duplicate id: untrustworthy accounting
      seen.add(result.id);
      if (result.status === "accepted" || result.status === "duplicate") {
        terminal.add(result.id);
      } else if (result.status === "rejected") {
        terminal.add(result.id);
        rejected += 1;
      }
      // Unknown statuses are ignored — those events stay queued.
    }
    const kept = batch.filter((event) => !terminal.has(event.eventId));
    if (kept.length === batch.length) {
      // No submitted event had a terminal result (unrelated ids, unknown
      // statuses, or empty results) — the response cannot be reconciled;
      // retry (this also prevents an unbounded in-flush loop).
      return "malformed";
    }
    return { kept, rejected };
  }

  private emit(level: PrismDiagnostic["level"], code: string, message: string): void {
    const diagnostic: PrismDiagnostic = {
      level,
      code,
      message,
      timestamp: this.runtime.now(),
    };
    for (const listener of this.diagnostics) listener(diagnostic);
  }

  /**
   * Identity state machine (slice-4 review F2): no identity before
   * consent, ONE stable ID while granted, none after withdrawal, and a
   * fresh context on re-grant. Persistent mode reads the stored ID,
   * validates its shape, and reuses it; on any failure the generated
   * value is kept in memory for this client lifetime with a coarse
   * diagnostic (never regenerated per event). "none" never touches
   * storage; "session" keeps the ID in memory only.
   */
  private async ensureAnonymousIdentity(): Promise<void> {
    if (this.persistence === "none" || this.state !== "granted") return;
    if (this.anonymousId !== null) return;
    const storage = this.runtime.storage;
    if (this.persistence === "persistent") {
      if (!storage) return;
      const existing = await storage.getItem(ANONYMOUS_ID_KEY).catch(() => null);
      if (existing && existing.length > 0 && existing.length <= 128) {
        // Reuse the stored identity — stable across launches.
        this.anonymousId = existing;
        return;
      }
      const fresh = this.runtime.createId();
      this.anonymousId = fresh;
      await storage.setItem(ANONYMOUS_ID_KEY, fresh).catch(() => {
        this.emit(
          "warn",
          "identity_storage_failed",
          "could not persist anonymous identity (kept for this client only)",
        );
      });
      return;
    }
    // "session" scope: in-memory for the client lifetime.
    this.anonymousId = this.runtime.createId();
  }
}

class SessionHandleImpl implements PrismSessionHandle {
  readonly sessionId: string;
  readonly startedAt: number;
  private readonly onEnd: (handle: SessionHandleImpl) => SessionEndResult;

  constructor(
    sessionId: string,
    startedAt: number,
    onEnd: (handle: SessionHandleImpl) => SessionEndResult,
  ) {
    this.sessionId = sessionId;
    this.startedAt = startedAt;
    this.onEnd = onEnd;
  }

  end(): SessionEndResult {
    return this.onEnd(this);
  }
}

/**
 * Async factory (ADR 0002 §7): validates options, loads persisted identity
 * state, and resolves only when the returned client is fully ready.
 */
export async function createPrismClient(options: PrismClientOptions): Promise<PrismClient> {
  const client = new PrismClientImpl(options);
  // Subscribe BEFORE ready() so initialization diagnostics (queue restore,
  // quarantine, purge) are observable through the public API.
  if (options.onDiagnostic) client.onDiagnostic(options.onDiagnostic);
  await client.ready();
  return client;
}
