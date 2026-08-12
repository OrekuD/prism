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

class PrismClientImpl implements PrismClient {
  readonly projectKey: string;
  readonly endpoint: string;
  readonly runtime: PrismClientOptions["runtime"];

  private readonly queue: EventQueue;
  private readonly queueOptions: Required<PrismQueueOptions>;
  private readonly diagnostics = new Set<(d: PrismDiagnostic) => void>();
  private readonly persistence: AnonymousPersistence;
  private state: CollectionState;
  private activeSession: SessionHandleImpl | null = null;
  private closed = false;
  private flushInFlight = false;
  private readonly abortSignal = createSignal();
  private cancelTimer: (() => void) | null = null;
  private attempts = new Map<string, number>();

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
    this.runtime = runtime;
    this.state = options.collection.initialState;
    this.persistence = options.collection.anonymousPersistence ?? "none";
    this.queueOptions = { ...DEFAULT_QUEUE, ...options.queue };
    this.queue = new EventQueue({
      maxEvents: this.queueOptions.maxQueueEvents,
      maxBytes: this.queueOptions.maxQueueBytes,
    });

    // Background delivery loop.
    this.cancelTimer = runtime.schedule(this.queueOptions.flushIntervalMs, () => {
      void this.tick();
    });

    // Best-effort flush before the host goes away.
    runtime.lifecycle?.on("before-unload", () => {
      void this.tick();
    });

    void this.ensureAnonymousIdentity();
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
    await this.ensureAnonymousIdentity();
  }

  track(name: string, properties?: JsonObject): CaptureResult {
    assertValidEventName(name);
    assertJsonSerializable(properties);

    if (this.closed) {
      return { status: "dropped", reason: "shutdown" };
    }
    if (this.state === "pending") {
      return { status: "dropped", reason: "consent-pending" };
    }
    if (this.state === "denied") {
      return { status: "dropped", reason: "consent-denied" };
    }

    const event: QueuedEvent = this.buildEvent(name, properties);
    if (!this.queue.enqueue(event)) {
      return { status: "dropped", reason: "queue-full" };
    }
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
      () => this.endSession(),
    );
    this.activeSession = handle;
    // The session-start event carries the session ID; if the queue is full
    // the session still exists locally (delivery is best-effort).
    this.queue.enqueue(this.buildEvent("session_started", options?.properties, handle.sessionId));
    return { status: "started", session: handle };
  }

  async flush(): Promise<void> {
    if (this.flushInFlight) return;
    this.flushInFlight = true;
    try {
      while (!this.queue.isEmpty) {
        const batch = this.queue.peekBatch(
          this.queueOptions.maxBatchEvents,
          this.queueOptions.maxBatchBytes,
        );
        if (batch.length === 0) break;
        const outcome = await this.deliver(batch);
        if (!outcome.ok) {
          throw outcome.error;
        }
        this.queue.removeFirst(batch.length);
      }
    } finally {
      this.flushInFlight = false;
    }
  }

  async shutdown(options?: { timeoutMs?: number }): Promise<void> {
    if (this.closed) return;
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = null;
    // Abort any in-flight transport request.
    this.abortSignal.abort();

    const timeoutMs = options?.timeoutMs ?? 10_000;
    if (!this.queue.isEmpty) {
      try {
        await Promise.race([
          this.flush(),
          new Promise((_, reject) =>
            setTimeout(() => reject(new Error("shutdown flush timed out")), timeoutMs),
          ),
        ]);
      } catch {
        this.emit("warn", "shutdown_flush_failed", "final flush did not complete");
      }
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
  ): Promise<{ ok: true } | { ok: false; error: unknown }> {
    const request = {
      body: JSON.stringify(batch.map((e) => JSON.parse(e.serialized))),
      timeoutMs: this.queueOptions.requestTimeoutMs,
      signal: this.abortSignal,
    };
    let response;
    try {
      response = await this.runtime.transport.post(`${this.endpoint}/api/v2/ingest`, request);
    } catch (error) {
      this.recordFailure(batch, error);
      return { ok: false, error };
    }
    if (response.status >= 200 && response.status < 300) {
      return { ok: true };
    }
    const error = new Error(`ingest responded ${response.status}`);
    const retryAfter = Number(response.headers["retry-after"] ?? 0);
    this.emit(
      "warn",
      "rate_limited",
      `ingest responded ${response.status}${retryAfter > 0 ? ` (retry-after ${retryAfter}s)` : ""}`,
    );
    this.recordFailure(batch, error);
    return { ok: false, error };
  }

  private recordFailure(batch: QueuedEvent[], error: unknown): void {
    const key = batch[0]?.eventId ?? "unknown";
    const attempts = (this.attempts.get(key) ?? 0) + 1;
    this.attempts.set(key, attempts);
    this.emit("warn", "delivery_failed", `batch delivery failed: ${String(error)}`);
    if (attempts >= this.queueOptions.maxRetries) {
      this.attempts.delete(key);
      this.queue.removeFirst(batch.length);
      this.emit("error", "batch_dropped", `batch dropped after ${attempts} failed attempts`);
    }
  }

  private endSession(): SessionEndResult {
    if (!this.activeSession) {
      return { status: "not-active" };
    }
    const handle = this.activeSession;
    this.activeSession = null;
    const event = this.buildEvent("session_ended", undefined, handle.sessionId);
    const queued = this.queue.enqueue(event);
    if (!queued) {
      this.emit("warn", "session_end_dropped", "session-end event was not queued");
    }
    return { status: "ended", eventId: event.eventId };
  }

  private async ensureAnonymousIdentity(): Promise<void> {
    // The envelope carries identity in the ingestion slice; here we only
    // honor the persistence contract (create/store/load the anonymous ID
    // when the policy requires durable storage).
    const storage = this.runtime.storage;
    if (this.persistence !== "none" && this.state === "granted" && storage) {
      const existing = await storage.getItem("prism:anonymous_id").catch(() => null);
      if (!existing) {
        await storage.setItem("prism:anonymous_id", this.runtime.createId()).catch(() => {
          this.emit("warn", "identity_storage_failed", "could not persist anonymous identity");
        });
      }
    }
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
}

class SessionHandleImpl implements PrismSessionHandle {
  readonly sessionId: string;
  readonly startedAt: number;
  private readonly onEnd: () => SessionEndResult;

  constructor(sessionId: string, startedAt: number, onEnd: () => SessionEndResult) {
    this.sessionId = sessionId;
    this.startedAt = startedAt;
    this.onEnd = onEnd;
  }

  end(): SessionEndResult {
    return this.onEnd();
  }
}

/**
 * Async factory (ADR 0002 §7): validates options and resolves to a READY
 * client. Rejects with a specific Error for invalid configuration.
 */
export async function createPrismClient(options: PrismClientOptions): Promise<PrismClient> {
  return new PrismClientImpl(options);
}
