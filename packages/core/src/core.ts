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
  PrismSessionHandle,
  PrismSignal,
  SessionEndResult,
  SessionStartResult,
} from "./contract";
import { EventQueue, type QueuedEvent } from "./queue";
import {
  assertEndpoint,
  assertJsonSerializable,
  assertProjectKey,
  assertValidEventName,
  sanitizeProperties,
} from "./validation";

const DEFAULT_QUEUE: Required<PrismQueueOptions> = {
  maxQueueEvents: 1000,
  maxQueueBytes: 1_048_576, // 1 MiB
  maxBatchEvents: 50,
  maxBatchBytes: 262_144, // 256 KiB
  requestTimeoutMs: 10_000,
  flushIntervalMs: 10_000,
  maxRetries: 5,
};

const ANONYMOUS_ID_KEY = "prism:anonymous_id";

// Retry policy (task-9 §6): exponential backoff, deterministic jitter,
// numeric Retry-After honored, at most one pending retry, maxRetries bound.
const RETRY_BASE_MS = 1_000;
const RETRY_MAX_MS = 60_000;

/** djb2 string hash — deterministic jitter without platform globals. */
function hashString(value: string): number {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) hash = (hash * 33) ^ value.charCodeAt(i);
  return hash >>> 0;
}

/** Numeric Retry-After (seconds) → ms; HTTP-date form falls back to exponential backoff. */
function parseRetryAfterSeconds(header: string | undefined): number | undefined {
  if (!header) return undefined;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
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
  private activeSession: SessionHandleImpl | null = null;
  private closed = false;
  private sessionAnonymousId: string | null = null;
  private flushPromise: Promise<void> | null = null;
  private inFlightSignal: AbortableSignal | null = null;
  private cancelTimer: (() => void) | null = null;
  private retryCancel: (() => void) | null = null;
  private attempts = new Map<string, number>();
  private queueRestored = false;
  private readonly lifecycleRemovers: Array<() => void> = [];
  private readonly instanceId: string;
  private readonly queueStorageKey: string;
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

    this.projectKey = options.projectKey;
    this.endpoint = options.endpoint.replace(/\/$/, "");
    // Queue persistence is namespaced per PROJECT (a reload of the same
    // execution context restores its queue). Tradeoff recorded (task-9 §6):
    // two tabs sharing the project key overwrite each other's snapshot —
    // server-side dedup by eventId covers the overlap, and the browser
    // adapter implements a storage lease in its slice.
    this.instanceId = runtime.createId();
    this.queueStorageKey = `prism:queue:v1:${this.projectKey}`;
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
    this.state = state;
    if (state === "denied") {
      // Consent withdrawal: nothing queued before the withdrawal may be
      // transmitted, the anonymous identity is deleted, the session closes,
      // and any in-flight delivery request is cancelled.
      this.queue.clear();
      void this.persistQueue();
      this.sessionAnonymousId = null;
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
    assertJsonSerializable(properties);
    const sanitized = sanitizeProperties(properties ?? {}, {
      denyList: this.denyList,
      maxDepth: this.maxDepth,
      maxStringLength: this.maxStringLength,
    });

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
    void this.persistQueue();
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
    const handle = new SessionHandleImpl(
      this.runtime.createId(),
      this.runtime.now(),
      (handleRef) => this.endSession(handleRef),
    );
    this.activeSession = handle;
    // The session-start event carries the session ID; if the queue is full
    // the session still exists locally (delivery is best-effort).
    const properties = sanitizeProperties(options?.properties ?? {}, {
      denyList: this.denyList,
      maxDepth: this.maxDepth,
      maxStringLength: this.maxStringLength,
    });
    this.queue.enqueue(this.buildEvent("session_started", properties, handle.sessionId));
    void this.persistQueue();
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
    while (!this.queue.isEmpty) {
      const batch = this.queue.peekBatch(
        this.queueOptions.maxBatchEvents,
        this.queueOptions.maxBatchBytes,
      );
      if (batch.length === 0) break;
      const signal = createSignal();
      this.inFlightSignal = signal;
      try {
        const outcome = await this.deliver(batch, signal);
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
      } finally {
        if (this.inFlightSignal === signal) this.inFlightSignal = null;
      }
    }
  }

  private buildEvent(name: string, properties?: JsonObject, sessionId?: string): QueuedEvent {
    const eventId = this.runtime.createId();
    const resolvedSessionId = sessionId ?? this.activeSession?.sessionId;
    const serialized = JSON.stringify({
      eventId,
      name,
      properties,
      timestamp: this.runtime.now(),
      sessionId: resolvedSessionId,
    });
    return {
      eventId,
      name,
      properties,
      timestamp: this.runtime.now(),
      sessionId: resolvedSessionId,
      serialized,
    };
  }

  private async deliver(
    batch: QueuedEvent[],
    signal: AbortableSignal,
  ): Promise<DeliverOutcome> {
    const request = {
      body: JSON.stringify(batch.map((e) => JSON.parse(e.serialized))),
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
        return { ok: false, error, exhausted: false };
      }
      const exhausted = this.handleFailure(batch, error);
      return { ok: false, error, exhausted };
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
    const retryAfterMs = parseRetryAfterSeconds(response.headers["retry-after"]);
    this.emit(
      "warn",
      "rate_limited",
      `ingest responded ${response.status}${
        retryAfterMs !== undefined ? ` (retry-after ${Math.round(retryAfterMs / 1000)}s)` : ""
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
    this.emit("warn", "delivery_failed", `batch delivery failed: ${String(error)}`);
    if (attempts >= this.queueOptions.maxRetries) {
      this.attempts.delete(key);
      this.emit("error", "batch_dropped", `batch dropped after ${attempts} failed attempts`);
      return true;
    }
    this.scheduleRetry(attempts, retryAfterMs);
    return false;
  }

  /**
   * Automatic retry loop (task-9 §6): exponential backoff from 1 s
   * (×2 per attempt, ±20% deterministic jitter), capped at 60 s; a numeric
   * Retry-After header is honored, also capped at 60 s; at most one retry
   * is pending at a time. Bounded by maxRetries via handleFailure.
   */
  private scheduleRetry(attempt: number, retryAfterMs?: number): void {
    if (this.retryCancel || this.closed) return;
    const exponential = Math.min(RETRY_BASE_MS * 2 ** (attempt - 1), RETRY_MAX_MS);
    const base =
      retryAfterMs !== undefined ? Math.min(retryAfterMs, RETRY_MAX_MS) : exponential;
    const jitter = 0.8 + (0.4 * (hashString(String(base)) % 1000)) / 1000;
    const delayMs = Math.max(1, Math.round(base * jitter));
    this.retryCancel = this.runtime.schedule(delayMs, () => {
      this.retryCancel = null;
      if (this.closed) return;
      void this.tick();
    });
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
      void this.persistQueue();
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
        const snapshot = JSON.stringify({
          v: 1,
          events: this.queue.snapshot().map((event) => event.serialized),
        });
        await storage.setItem(this.queueStorageKey, snapshot);
      })
      .catch(() => {
        this.emit("warn", "queue_persist_failed", "could not persist the queue");
      });
    return this.persistChain;
  }

  /**
   * Restore the persisted queue. Consent-aware: under `granted` the
   * snapshot is rehydrated (once); under `pending` it is left untouched
   * and restored when consent is granted; under `denied` it is purged —
   * nothing collected before a withdrawal may ever transmit. Corrupt or
   * future-version state is quarantined (cleared + removed) with a
   * diagnostic.
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
      const parsed = JSON.parse(raw) as { v?: number; events?: unknown };
      if (parsed?.v !== 1 || !Array.isArray(parsed.events)) {
        throw new Error("unsupported queue state version");
      }
      for (const serialized of parsed.events as unknown[]) {
        if (typeof serialized !== "string") throw new Error("corrupt queue entry");
        const event = JSON.parse(serialized) as Omit<QueuedEvent, "serialized">;
        this.queue.enqueue({ ...event, serialized });
      }
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

  private async ensureAnonymousIdentity(): Promise<void> {
    if (this.persistence === "none" || this.state !== "granted") return;
    const storage = this.runtime.storage;
    if (this.persistence === "persistent") {
      if (!storage) return;
      const existing = await storage.getItem(ANONYMOUS_ID_KEY).catch(() => null);
      if (!existing) {
        await storage.setItem(ANONYMOUS_ID_KEY, this.runtime.createId()).catch(() => {
          this.emit("warn", "identity_storage_failed", "could not persist anonymous identity");
        });
      }
    } else {
      // "session" scope: in-memory for the client lifetime.
      this.sessionAnonymousId ??= this.runtime.createId();
    }
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
