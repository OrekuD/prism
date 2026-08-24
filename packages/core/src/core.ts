import type {
	AnonymousPersistence,
	CaptureResult,
	CollectionState,
	GlobalPropertyResult,
	GlobalPropertyScope,
	IdentifyResult,
	JsonObject,
	PrismClient,
	PrismClientOptions,
	PrismDiagnostic,
	PrismDiagnosticHandle,
	PrismIdentityState,
	PrismQueueOptions,
	PrismRuntimeAdapter,
	PrismRuntimeContext,
	PrismSessionHandle,
	PrismSignal,
	ResetResult,
	SessionEndResult,
	SessionStartResult,
	WireIdentifyOp,
} from "./contract";
import {
	INTERNAL_SEAM,
	type InternalClientSeam,
	type ReservedEventResult,
} from "./internal-seam";
import {
	INGEST_LIMITS,
	SDK_NAME,
	SDK_VERSION,
	WIRE_SCHEMA_VERSION,
	type WireContext,
	type WireEnvelope,
} from "./limits";
import {
	PAGE_VIEW_EVENT_NAME,
	RESERVED_EVENT_PREFIX,
	isReservedAnalyticsEventName,
	validatePageViewProperties,
} from "./page-view";
import {
	APP_LIFECYCLE_EVENT_NAME,
	SCREEN_VIEW_EVENT_NAME,
	validateAppLifecycleProperties,
	validateScreenViewProperties,
} from "./screen-view";
import { EventQueue, type QueuedEvent, utf8Length } from "./queue";
import {
	assertEndpoint,
	assertJsonSerializable,
	assertSourceKey,
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

interface PersistedIdentityState {
	v: 1;
	anonymousId: string | null;
	userId: string | null;
	lastOpId: string | null;
	/** Incremented on every reset — stale identity writes cannot win. */
	generation: number;
}

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
	for (let i = 0; i < value.length; i += 1)
		hash = (hash * 33) ^ value.charCodeAt(i);
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
	| {
			readonly ok: false;
			readonly error: unknown;
			readonly exhausted: boolean;
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

/** Bound a promise with the runtime scheduler (no global setTimeout). */
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

class PrismClientImpl implements PrismClient {
	readonly sourceKey: string;
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

	// Identity (task-10 §3): the known external user, the last identify op,
	// and the explicit global-property scopes.
	private knownUserId: string | null = null;
	private lastIdentifyOpId: string | null = null;
	private readonly globalProperties: Record<
		GlobalPropertyScope,
		Map<string, unknown>
	> = {
		memory: new Map(),
		session: new Map(),
		persistent: new Map(),
	};
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
	private readonly globalsStorageKeys: {
		session: string;
		persistent: string;
	};
	private identityStateKey: string;
	private identityGeneration = 0;
	private readonly wireContext: WireContext;
	private persistChain: Promise<void> = Promise.resolve();

	constructor(options: PrismClientOptions) {
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
		if (
			options.collection.anonymousPersistence === "persistent" &&
			!runtime.storage
		) {
			throw new Error(
				"anonymousPersistence 'persistent' requires runtime.storage",
			);
		}
		if (
			!["pending", "granted", "denied"].includes(
				options.collection.initialState,
			)
		) {
			throw new Error(
				"collection.initialState must be pending, granted, or denied",
			);
		}
		// INGEST_LIMITS are hard protocol ceilings (task-9 slice-4 review F3):
		// a client configured above them could produce batches or events the
		// ingestion server must reject, causing permanent data loss.
		this.assertConfigWithinWireLimits(options.queue ?? {});

		this.sourceKey = options.sourceKey;
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
		)}:${this.sourceKey}`;
		const scope = (name: string) =>
			`prism:globals:${name}:${hashString(options.endpoint)}:${this.sourceKey}`;
		this.globalsStorageKeys = {
			session: scope("session"),
			persistent: scope("persistent"),
		};
		// R3-F2: the identity-state key is persistence-policy-scoped. The
		// browser routes "session" keys to sessionStorage (per execution
		// context) and "persistent" keys to localStorage (cross-launch);
		// "none" never reads or writes identity state at all.
		this.identityStateKey = `prism:identity:${options.collection.anonymousPersistence ?? "none"}:${hashString(options.endpoint)}:${this.sourceKey}`;
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

		// Task 17 §2/§3: symbol-keyed internal seams for the Browser package
		// (reserved page-view creation + Web-session resume). Symbol keys are
		// unreachable through normal property access and never part of the
		// public PrismClient contract.
		const impl = this;
		const seam: InternalClientSeam = {
			createReservedEvent(
				name: string,
				properties?: Record<string, unknown>,
			): ReservedEventResult {
				type Internals = {
					closed: boolean;
					state: CollectionState;
					queue: { enqueue(event: QueuedEvent): boolean };
					validateAndSanitize(p?: JsonObject): JsonObject;
					buildEvent(n: string, p?: JsonObject): QueuedEvent;
					afterEnqueue(): Promise<void>;
				};
				const self = impl as unknown as Internals;
				if (self.closed) return { status: "dropped", reason: "shutdown" };
				try {
					assertValidEventName(name);
				} catch (error) {
					return {
						status: "rejected",
						reason: error instanceof Error ? error.message : "invalid-name",
					};
				}
				if (name === PAGE_VIEW_EVENT_NAME) {
					const validation = validatePageViewProperties(properties);
					if (!validation.ok) {
						return { status: "rejected", reason: validation.reason };
					}
				}
				if (name === SCREEN_VIEW_EVENT_NAME) {
					const validation = validateScreenViewProperties(properties as unknown);
					if (!validation.ok) {
						return { status: "rejected", reason: validation.reason };
					}
				}
				if (name === APP_LIFECYCLE_EVENT_NAME) {
					const validation = validateAppLifecycleProperties(properties as unknown);
					if (!validation.ok) {
						return { status: "rejected", reason: validation.reason };
					}
				}
				let sanitized: JsonObject | undefined;
				try {
					sanitized = self.validateAndSanitize(
						(properties ?? undefined) as JsonObject | undefined,
					);
				} catch {
					return { status: "rejected", reason: "invalid-properties" };
				}
				if (self.state === "pending") {
					return { status: "dropped", reason: "consent-pending" };
				}
				if (self.state === "denied") {
					return { status: "dropped", reason: "consent-denied" };
				}
				const event = self.buildEvent(name, sanitized);
				if (!self.queue.enqueue(event)) {
					return { status: "dropped", reason: "queue-full" };
				}
				void self.afterEnqueue();
				return { status: "queued", eventId: event.eventId };
			},
			resumeWebSession(session: {
				sessionId: string;
				startedAt: number;
			}): void {
				if (impl.closed || !session.sessionId) return;
				if (
					impl.activeSession &&
					impl.activeSession.sessionId === session.sessionId
				) {
					return; // already attached
				}
				// Replace the in-memory session WITHOUT emitting started/ended:
				// a resumed session's id comes from persisted Web-session state
				// and its start event shipped on the original navigation.
				impl.activeSession = new SessionHandleImpl(
					session.sessionId,
					session.startedAt,
					(handleRef) => impl.endSession(handleRef),
				);
			},
			detachWebSession(): void {
				// Consent withdrawal / reset: drop the attachment only — no
				// session_ended, because withdrawal must never produce events.
				impl.activeSession = null;
			},
			resumeMobileSession(session: { sessionId: string; startedAt: number; sequence: number }): void {
				if (impl.closed || !session.sessionId) return;
				impl.activeSession = new SessionHandleImpl(
					session.sessionId,
					session.startedAt,
					(handleRef) => impl.endSession(handleRef),
				);
			},
			detachMobileSession(): void {
				impl.activeSession = null;
			},
		};
		(this as unknown as Record<symbol, unknown>)[INTERNAL_SEAM] = seam;
	}

	/** Called by the factory before resolving — the client is fully ready. */
	async ready(): Promise<void> {
		// R3-F2: "none" never restores identity state from storage.
		if (this.persistence !== "none") {
			await this.restoreIdentityState();
		}
		await this.restoreQueueState();
		await this.restoreGlobalProperties();
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
			// transmitted, the anonymous identity is deleted, the session
			// closes, identity links/queued ops and global properties are
			// cleared (task-10 §3), and any in-flight delivery is cancelled.
			this.queue.clear();
			void this.persistQueue();
			this.anonymousId = null;
			this.knownUserId = null;
			this.lastIdentifyOpId = null;
			this.queue.removeAllOps();
			for (const scope of ["memory", "session", "persistent"] as const) {
				this.globalProperties[scope].clear();
			}
			void this.persistGlobalProperties();
			this.activeSession = null;
			this.inFlightSignal?.abort();
			this.cancelRetry();
			await this.runtime.storage?.removeItem(ANONYMOUS_ID_KEY);
			// R3-F1: persist the SIGNED-OUT identity state (generation advances)
			// so a re-grant or a fresh client on the same storage can never
			// restore the pre-withdrawal user.
			this.identityGeneration += 1;
			try {
				await this.persistIdentityState();
			} catch {
				this.emit(
					"warn",
					"identity_state_persist_failed",
					"could not persist signed-out identity state",
				);
			}
			await this.persistQueue();
		}
		if (state === "granted") {
			// A queue snapshot deferred under pending is restored on grant.
			if (this.persistence !== "none") {
				await this.restoreIdentityState();
			}
			await this.restoreQueueState();
			await this.restoreGlobalProperties();
			await this.ensureAnonymousIdentity();
		}
	}

	track(name: string, properties?: JsonObject): CaptureResult {
		assertValidEventName(name);
		// Task 17 §1: `$prism_*` is the SDK-owned analytics namespace. Public
		// callers can never create reserved events (page views are created by
		// the internal page tracker seam, which validates the strict property
		// schema separately). Throw like any other invalid-input error.
		if (isReservedAnalyticsEventName(name)) {
			throw new Error(
				`Event name uses the reserved "${RESERVED_EVENT_PREFIX}" prefix`,
			);
		}
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
		this.queue.enqueue(
			this.buildEvent("session_started", properties, handle.sessionId),
		);
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
			this.emit(
				"warn",
				"shutdown_flush_failed",
				"final flush did not complete",
			);
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
				throw new Error(
					`${key} must be a finite positive integer (got ${value})`,
				);
			}
		}
		const ceiling = (
			label: string,
			value: number | undefined,
			max: number,
		): void => {
			if (value !== undefined && value > max) {
				throw new Error(`${label} ${value} exceeds the wire ceiling (${max})`);
			}
		};
		ceiling(
			"maxBatchEvents",
			queue.maxBatchEvents,
			INGEST_LIMITS.maxBatchEvents,
		);
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
		if (
			context.kind === "web" ||
			context.kind === "server" ||
			context.kind === "mobile"
		) {
			picked.kind = context.kind;
		}
		if (
			context.screenSize &&
			Number.isFinite(context.screenSize.width) &&
			Number.isFinite(context.screenSize.height)
		) {
			picked.screenSize = {
				width: context.screenSize.width,
				height: context.screenSize.height,
			};
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
			if (typeof context.app.version === "string")
				app.version = context.app.version;
			if (typeof context.app.build === "string") app.build = context.app.build;
			if (Object.keys(app).length > 0) picked.app = app;
		}
		if (context.device) {
			const device: { model?: string; manufacturer?: string } = {};
			if (typeof context.device.model === "string")
				device.model = context.device.model;
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
			throw new Error(
				`runtime context is not JSON-safe (${validation.reason})`,
			);
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

	onDiagnostic(
		listener: (diagnostic: PrismDiagnostic) => void,
	): PrismDiagnosticHandle {
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
	get identity(): PrismIdentityState {
		return {
			anonymousId: this.anonymousId ?? "",
			userId: this.knownUserId,
			lastOpId: this.lastIdentifyOpId,
		};
	}

	async identify(userId: string, traits?: JsonObject): Promise<IdentifyResult> {
		if (this.closed) return { status: "dropped", reason: "shutdown" };
		if (this.state !== "granted") {
			return {
				status: "dropped",
				reason: this.state === "pending" ? "consent-pending" : "consent-denied",
			};
		}
		// userId: opaque string, documented ceilings (1..256 chars, no control
		// characters) — never email-shaped requirements, never inferred.
		if (
			typeof userId !== "string" ||
			userId.length === 0 ||
			userId.length > 256 ||
			/[\x00-\x1f\x7f]/.test(userId)
		) {
			return { status: "dropped", reason: "invalid-user-id" };
		}
		let sanitizedTraits: JsonObject | undefined;
		let unsetKeys: string[] = [];
		if (traits !== undefined) {
			const validation = validateJsonValue(traits, {
				maxDepth: this.maxDepth,
				maxStringLength: this.maxStringLength,
				maxKeys: INGEST_LIMITS.maxPropertyKeys,
				maxArrayElements: INGEST_LIMITS.maxArrayElements,
			});
			if (!validation.ok) {
				return { status: "dropped", reason: "invalid-traits" };
			}
			const rawTraits = traits as Record<string, unknown>;
			const unset = rawTraits["$unset"];
			if (unset !== undefined) {
				if (
					!Array.isArray(unset) ||
					unset.length > 50 ||
					!unset.every(
						(key) =>
							typeof key === "string" &&
							key.length > 0 &&
							key.length <= 128 &&
							!/[\x00-\x1f\x7f]/.test(key),
					)
				) {
					return { status: "dropped", reason: "invalid-traits" };
				}
				unsetKeys = unset as string[];
			}
			const withoutUnset: Record<string, unknown> = {};
			for (const [key, value] of Object.entries(rawTraits)) {
				if (key !== "$unset") withoutUnset[key] = value;
			}
			sanitizedTraits = sanitizeProperties(withoutUnset as JsonObject, {
				denyList: this.denyList,
				maxDepth: this.maxDepth,
				maxStringLength: this.maxStringLength,
			});
		}

		// STAGED identity transition (F9): nothing live changes until the
		// operation is durably enqueued. Conflict safety (ADR 0003): an
		// anonymous context already linked to a DIFFERENT external user
		// rotates to a fresh anonymous context — two known people are never
		// merged over a shared device. Under anonymousPersistence "none" a
		// transient in-memory ID satisfies the wire contract (F10).
		const stagedAnon =
			this.knownUserId !== null && this.knownUserId !== userId
				? this.runtime.createId()
				: (this.anonymousId ?? this.runtime.createId());

		const opId = this.runtime.createId();
		const occurredAt = this.runtime.now();
		const op: WireIdentifyOp = {
			opId,
			userId,
			anonymousId: stagedAnon,
			...(sanitizedTraits ? { traits: sanitizedTraits } : {}),
			...(unsetKeys.length > 0 ? { unset: unsetKeys } : {}),
			occurredAt,
		};

		const queued = this.queue.enqueue({
			owner: this.instanceId,
			kind: "identify",
			eventId: opId,
			timestamp: occurredAt,
			serialized: JSON.stringify(op),
		});
		if (!queued) {
			// Nothing changed: live identity and later event envelopes are
			// untouched by the failed identify (F9).
			return { status: "dropped", reason: "queue-full" };
		}

		// Commit the live state ONLY after the enqueue succeeded.
		if (stagedAnon !== this.anonymousId) {
			this.anonymousId = stagedAnon;
			if (this.persistence === "persistent") {
				try {
					await this.persistAnonymousIdentity();
				} catch {
					this.emit(
						"warn",
						"identity_persist_failed",
						"could not persist the rotated anonymous id",
					);
				}
			}
		}
		this.knownUserId = userId;
		this.lastIdentifyOpId = opId;

		// F1: persist the identity state (known user, anon id, generation).
		try {
			await this.persistIdentityState();
		} catch {
			this.emit(
				"warn",
				"identity_state_persist_failed",
				"could not persist identity state",
			);
		}
		// F10: await the durable queue write before resolving — the caller's
		// promise reflects the persistence attempt, with a diagnostic on
		// failure (the op stays queued in memory).
		await this.persistQueue();
		void this.afterEnqueue();
		return {
			status: "queued",
			opId,
			userId,
			anonymousId: stagedAnon,
		};
	}

	async reset(): Promise<ResetResult> {
		if (this.closed) return { status: "blocked", reason: "shutdown" };
		// Close the active session honestly (a session_ended event in the OLD
		// identity context — queued events are never relabeled).
		if (this.activeSession) {
			this.endSession(this.activeSession);
		}
		// Clear queued identify operations (tombstoned — never delivered).
		this.queue.removeAllOps();
		// Clear every global-property scope and persist the empty state.
		for (const scope of ["memory", "session", "persistent"] as const) {
			this.globalProperties[scope].clear();
		}
		try {
			await this.persistGlobalProperties();
		} catch {
			this.emit(
				"warn",
				"globals_persist_failed",
				"could not persist cleared global properties",
			);
		}
		// Rotate the anonymous identity (the previous user's context is gone).
		const fresh = this.runtime.createId();
		this.anonymousId = fresh;
		if (this.persistence === "persistent") {
			try {
				await this.persistAnonymousIdentity();
			} catch {
				this.emit(
					"warn",
					"identity_persist_failed",
					"could not persist the reset anonymous id",
				);
			}
		}
		this.knownUserId = null;
		this.lastIdentifyOpId = null;
		// F1: persist the SIGNED-OUT identity state (generation advances) so
		// a fresh client on the same device never adopts the previous user —
		// and await it before resolving.
		this.identityGeneration += 1;
		try {
			await this.persistIdentityState();
		} catch {
			this.emit(
				"warn",
				"identity_state_persist_failed",
				"could not persist signed-out identity state",
			);
		}
		await this.persistQueue();
		return { status: "ok", anonymousId: fresh };
	}

	async setGlobalProperty(
		key: string,
		value: unknown,
		scope: GlobalPropertyScope = "memory",
	): Promise<GlobalPropertyResult> {
		if (this.closed) return { status: "blocked", reason: "shutdown" };
		// Invalid keys/values are CALLER errors — a specific validation error
		// is thrown (F13); "storage-failure" is reserved for adapter failures.
		this.assertGlobalProperty(key, value);
		this.globalProperties[scope].set(key, value);
		try {
			await this.persistGlobalProperties();
		} catch {
			// the in-memory value is stable; a diagnostic records the gap
			this.emit(
				"warn",
				"globals_persist_failed",
				"could not persist global properties",
			);
		}
		return { status: "ok" };
	}

	async unsetGlobalProperty(
		key: string,
		scope: GlobalPropertyScope = "memory",
	): Promise<GlobalPropertyResult> {
		if (this.closed) return { status: "blocked", reason: "shutdown" };
		this.globalProperties[scope].delete(key);
		try {
			await this.persistGlobalProperties();
		} catch {
			this.emit(
				"warn",
				"globals_persist_failed",
				"could not persist global properties",
			);
		}
		return { status: "ok" };
	}

	async clearGlobalProperties(
		scope?: GlobalPropertyScope,
	): Promise<GlobalPropertyResult> {
		if (this.closed) return { status: "blocked", reason: "shutdown" };
		if (scope) {
			this.globalProperties[scope].clear();
		} else {
			for (const s of ["memory", "session", "persistent"] as const) {
				this.globalProperties[s].clear();
			}
		}
		try {
			await this.persistGlobalProperties();
		} catch {
			this.emit(
				"warn",
				"globals_persist_failed",
				"could not persist global properties",
			);
		}
		return { status: "ok" };
	}

	private assertGlobalProperty(key: string, value: unknown): void {
		if (typeof key !== "string" || key.length === 0 || key.length > 128) {
			throw new Error("global property key must be a 1..128 character string");
		}
		if (/[\x00-\x1f\x7f]/.test(key)) {
			throw new Error(
				"global property key must not contain control characters",
			);
		}
		if (key === "__proto__" || key === "constructor" || key === "prototype") {
			throw new Error("global property key is dangerous");
		}
		const validation = validateJsonValue(value, {
			maxDepth: this.maxDepth,
			maxStringLength: this.maxStringLength,
			maxKeys: INGEST_LIMITS.maxPropertyKeys,
			maxArrayElements: INGEST_LIMITS.maxArrayElements,
		});
		if (!validation.ok) {
			throw new Error(
				`global property value is not JSON-safe (${validation.reason})`,
			);
		}
	}

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
			// F2: identify-only delivery — pending operations flush even when
			// there are no events (the v3 envelope may carry events: []).
			if (batch.length === 0 && this.queue.pendingOps().length === 0) break;
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
			const batchIds = batch.map((entry) => entry.eventId);
			if (!outcome.ok) {
				if (outcome.exhausted) {
					this.queue.removeBatch(batchIds);
					this.queue.removeAllOps();
					void this.persistQueue();
				}
				throw outcome.error;
			}
			this.queue.removeBatch(batchIds);
			// R3-F5: identity-outcome reconciliation — accepted and duplicate
			// ops leave the queue; rejected ops are dropped with a coarse
			// diagnostic (a conflicting-payload replay can never be fixed by
			// retrying it).
			const pendingOpIds = this.queue.pendingOps().map((op) => op.eventId);
			// R3-F5: when the server omits identity outcomes, a 2xx means the
			// submitted operations were processed — remove them all. When it
			// DOES return outcomes, remove accepted/duplicate ops and drop
			// rejected ones with a coarse diagnostic.
			let acceptedOpIds: Set<string>;
			let rejectedOps: Array<{ opId: string; status: string }>;
			if (outcome.identityOutcomes && outcome.identityOutcomes.length > 0) {
				acceptedOpIds = new Set(
					outcome.identityOutcomes
						.filter(
							(entry) =>
								entry.status === "accepted" || entry.status === "duplicate",
						)
						.map((entry) => entry.opId),
				);
				rejectedOps = outcome.identityOutcomes.filter(
					(entry) => entry.status === "rejected",
				);
			} else {
				acceptedOpIds = new Set(pendingOpIds);
				rejectedOps = [];
			}
			for (const entry of rejectedOps) {
				this.emit(
					"warn",
					"identify_rejected",
					"identity operation was rejected by the server",
				);
			}
			// rejected ops are TERMINAL too — they leave the queue (retrying a
			// conflicting-payload replay can never succeed).
			this.queue.removeOps(
				pendingOpIds.filter(
					(id) =>
						acceptedOpIds.has(id) ||
						rejectedOps.some((entry) => entry.opId === id),
				),
			);
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

	/**
	 * Global-property merge (task-10 §3): persistent < session < memory
	 * precedence, then per-event properties win over ALL globals — without
	 * mutating the stored globals.
	 */
	private mergeGlobalProperties(properties?: JsonObject): JsonObject {
		const merged: JsonObject = {};
		for (const scope of ["persistent", "session", "memory"] as const) {
			for (const [key, value] of this.globalProperties[scope]) {
				(merged as Record<string, unknown>)[key] = value;
			}
		}
		if (properties) {
			for (const [key, value] of Object.entries(properties)) {
				(merged as Record<string, unknown>)[key] = value;
			}
		}
		return merged;
	}

	private buildEvent(
		name: string,
		properties?: JsonObject,
		sessionId?: string,
	): QueuedEvent {
		const eventId = this.runtime.createId();
		const resolvedSessionId = sessionId ?? this.activeSession?.sessionId;
		const now = this.runtime.now();
		// Context is the allowlisted, validated, sanitized snapshot (F16).
		const context = this.wireContext;
		const envelope: WireEnvelope & { userId?: string } = {
			schemaVersion: WIRE_SCHEMA_VERSION,
			eventId,
			type: "track",
			occurredAt: now,
			sessionId: resolvedSessionId,
			anonymousId: this.anonymousId ?? undefined,
			// The KNOWN identity at enqueue time (immutable once serialized):
			// a later reset()/identify() can never relabel this event.
			...(this.knownUserId ? { userId: this.knownUserId } : {}),
			name,
			properties: this.mergeGlobalProperties(properties),
			context,
		};
		const serialized = JSON.stringify(envelope);
		return {
			owner: this.instanceId,
			kind: "event",
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
	): Promise<
		DeliverOutcome & {
			identityOutcomes?: Array<{ opId: string; status: string }>;
		}
	> {
		const request = {
			// The v3 batch envelope (task-10): SDK identity at batch level, and
			// pending identify operations delivered with (and applied before)
			// the events — deterministic operation ordering.
			body: JSON.stringify({
				schemaVersion: WIRE_SCHEMA_VERSION,
				sentAt: this.runtime.now(),
				sdk: { name: SDK_NAME, version: SDK_VERSION },
				...(this.queue.pendingOps().length > 0
					? {
							identity: this.queue
								.pendingOps()
								.map((op) => JSON.parse(op.serialized) as WireIdentifyOp),
						}
					: {}),
				events: batch.map((e) => JSON.parse(e.serialized)),
			}),
			// Authentication is part of the transport contract (F1): the core
			// owns Prism authentication semantics; adapters forward these
			// headers unchanged and never log them. The project key never
			// appears in diagnostics or error messages.
			headers: {
				authorization: `Bearer ${this.sourceKey}`,
				"content-type": "application/json",
			},
			timeoutMs: this.queueOptions.requestTimeoutMs,
			signal,
		};
		let response;
		try {
			response = await this.runtime.transport.post(
				`${this.endpoint}/api/v2/ingest`,
				request,
			);
		} catch (error) {
			if (signal.aborted) {
				// Intentional cancellation (consent withdrawal / shutdown): never
				// counts toward retry exhaustion and never drops the batch — the
				// fresh final attempt delivers it.
				this.emit("warn", "delivery_cancelled", "in-flight delivery cancelled");
				return {
					ok: false,
					error: new Error("batch delivery cancelled"),
					exhausted: false,
				};
			}
			// Coarse SDK-owned error (F17): arbitrary transport error text may
			// embed the authorization header (the project key) — it must never
			// cross the public API through rejected flushes or diagnostics.
			const coarse = new Error("batch delivery failed");
			const exhausted = this.handleFailure(batch, coarse);
			return { ok: false, error: coarse, exhausted };
		}
		if (response.status >= 200 && response.status < 300) {
			// R4-F1: read + parse the response body EXACTLY ONCE — the browser
			// transport's Response body is single-consumption. Event and
			// identity outcomes derive from the same parsed value.
			let bodyText: string | null = null;
			try {
				bodyText = await response.text();
			} catch {
				bodyText = null;
			}
			const reconciled = await this.reconcileResults(batch, bodyText);
			let identityOutcomes: Array<{ opId: string; status: string }> = [];
			if (bodyText !== null) {
				try {
					const parsed = JSON.parse(bodyText) as {
						identity?: Array<{ opId?: unknown; status?: unknown }>;
					};
					if (Array.isArray(parsed.identity)) {
						identityOutcomes = parsed.identity
							.filter(
								(entry): entry is { opId: string; status: string } =>
									typeof entry.opId === "string" &&
									typeof entry.status === "string",
							)
							.map((entry) => ({ opId: entry.opId, status: entry.status }));
					}
				} catch {
					// non-JSON body: no identity outcomes
				}
			}
			if (reconciled === "malformed") {
				// Cannot trust the accounting — retry (server-side dedup by
				// eventId makes a resend safe).
				const error = new Error("ingest returned malformed batch results");
				const exhausted = this.handleFailure(batch, error);
				return { ok: false, error, exhausted, identityOutcomes };
			}
			if (reconciled === null) {
				// No results body: status-only success — the whole batch is done.
				return { ok: true, kind: "accepted", identityOutcomes };
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
				identityOutcomes,
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
	private handleFailure(
		batch: QueuedEvent[],
		error: unknown,
		retryAfterMs?: number,
	): boolean {
		const key = batch[0]?.eventId ?? "unknown";
		const attempts = (this.attempts.get(key) ?? 0) + 1;
		this.attempts.set(key, attempts);
		// Coarse diagnostic only — never String(error) text (F17).
		this.emit("warn", "delivery_failed", "batch delivery failed");
		if (attempts >= this.queueOptions.maxRetries) {
			this.attempts.delete(key);
			this.emit(
				"error",
				"batch_dropped",
				`batch dropped after ${attempts} failed attempts`,
			);
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
			"retry_scheduled",
			`retry ${attempt} scheduled in ${delayMs} ms`,
		);
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
			this.emit(
				"warn",
				"session_end_dropped",
				"session-end event was not queued",
			);
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
	/**
	 * Persist the LIVE identity state (F1): known user, anonymous id, and a
	 * logout generation — stored separately from the immutable queue so a
	 * fresh client on a shared device never infers the previous user from
	 * queued events. The generation guard is a best-effort compare-and-swap
	 * against stale writers.
	 */
	private async persistIdentityState(): Promise<void> {
		const storage = this.runtime.storage;
		// R3-F2: only "session" and "persistent" write identity state; "none"
		// (documented as no identity) never touches storage for it.
		if (!storage || this.persistence === "none") return;
		const state: PersistedIdentityState = {
			v: 1,
			anonymousId: this.anonymousId,
			userId: this.knownUserId,
			lastOpId: this.lastIdentifyOpId,
			generation: this.identityGeneration,
		};
		// Best-effort stale-writer guard: never lower the generation.
		try {
			const raw = await storage.getItem(this.identityStateKey);
			if (raw) {
				const existing = JSON.parse(raw) as { generation?: number };
				if (
					typeof existing.generation === "number" &&
					existing.generation > state.generation
				) {
					this.identityGeneration = existing.generation;
					state.generation = existing.generation;
					// The stored state belongs to a newer generation — keep it.
					return;
				}
			}
		} catch {
			// unreadable state — write ours
		}
		await storage.setItem(this.identityStateKey, JSON.stringify(state));
	}

	/** Restore the LIVE identity state (F1) — never inferred from the queue. */
	private async restoreIdentityState(): Promise<void> {
		const storage = this.runtime.storage;
		if (!storage) return;
		try {
			const raw = await storage.getItem(this.identityStateKey);
			if (!raw) return;
			const parsed = JSON.parse(raw) as Partial<PersistedIdentityState>;
			if (parsed?.v !== 1) return;
			if (typeof parsed.generation === "number") {
				this.identityGeneration = parsed.generation;
			}
			if (
				typeof parsed.anonymousId === "string" &&
				parsed.anonymousId.length > 0
			) {
				// canonical decode: the raw form; tolerate the legacy JSON-wrapped
				// form and rewrite it canonically (F11)
				let id = parsed.anonymousId;
				if (id.startsWith('"')) {
					try {
						const decoded = JSON.parse(id) as unknown;
						if (typeof decoded === "string") id = decoded;
					} catch {
						id = parsed.anonymousId;
					}
				}
				if (id.length > 0 && id.length <= 128) {
					this.anonymousId = id;
				}
			}
			if (typeof parsed.userId === "string" && parsed.userId.length > 0) {
				this.knownUserId = parsed.userId;
				this.lastIdentifyOpId =
					typeof parsed.lastOpId === "string" ? parsed.lastOpId : null;
			}
		} catch {
			this.emit(
				"warn",
				"identity_state_restore_failed",
				"could not restore identity state",
			);
		}
	}

	/** Persist the current anonymous identity (persistent scope). */
	private async persistAnonymousIdentity(): Promise<void> {
		const storage = this.runtime.storage;
		if (!storage || this.persistence !== "persistent") return;
		if (!this.anonymousId) {
			await storage.removeItem(ANONYMOUS_ID_KEY);
			return;
		}
		// canonical encoding: the raw string (F11). The legacy JSON-wrapped
		// format is tolerated on read and rewritten canonically.
		await storage.setItem(ANONYMOUS_ID_KEY, this.anonymousId);
	}

	/** Persist the session + persistent global-property scopes. */
	private async persistGlobalProperties(): Promise<void> {
		const storage = this.runtime.storage;
		if (!storage) return;
		for (const scope of ["session", "persistent"] as const) {
			const key = this.globalsStorageKeys[scope];
			const values = Object.fromEntries(this.globalProperties[scope]);
			if (Object.keys(values).length === 0) {
				await storage.removeItem(key);
			} else {
				await storage.setItem(key, JSON.stringify(values));
			}
		}
	}

	/**
	 * Restore the session + persistent global-property scopes (best-effort).
	 * F13: the persisted globals are revalidated and redacted before
	 * adoption — hostile stored state (dangerous keys, oversized values,
	 * invalid shapes) is QUARANTINED, never merged into events.
	 */
	private async restoreGlobalProperties(): Promise<void> {
		const storage = this.runtime.storage;
		if (!storage) return;
		for (const scope of ["session", "persistent"] as const) {
			try {
				const raw = await storage.getItem(this.globalsStorageKeys[scope]);
				if (!raw) continue;
				const parsed = JSON.parse(raw) as Record<string, unknown>;
				if (
					typeof parsed !== "object" ||
					parsed === null ||
					Array.isArray(parsed)
				) {
					// malformed persisted globals — quarantine the whole scope
					await storage
						.removeItem(this.globalsStorageKeys[scope])
						.catch(() => undefined);
					this.emit(
						"warn",
						"globals_restore_failed",
						"quarantined malformed global properties",
					);
					continue;
				}
				for (const [key, value] of Object.entries(parsed)) {
					try {
						this.assertGlobalProperty(key, value);
					} catch {
						// quarantine the invalid entry only — valid entries survive
						continue;
					}
					// reapply the redaction policy to persisted values (F13)
					const sanitized =
						typeof value === "object" && value !== null && !Array.isArray(value)
							? sanitizeProperties(value as JsonObject, {
									denyList: this.denyList,
									maxDepth: this.maxDepth,
									maxStringLength: this.maxStringLength,
								})
							: value;
					this.globalProperties[scope].set(key, sanitized);
				}
			} catch {
				this.emit(
					"warn",
					"globals_restore_failed",
					"could not restore global properties",
				);
			}
		}
	}

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
					kind: event.kind,
					...(event.name !== undefined ? { name: event.name } : {}),
					eventId: event.eventId,
					occurredAt: event.timestamp,
					serialized: event.serialized,
				}));
				let merged = current;
				try {
					const raw = await storage.getItem(this.queueStorageKey);
					if (raw) {
						const parsed = JSON.parse(raw) as { v?: number; events?: unknown };
						// F4: preserve other-owner segments for the CURRENT v4 format
						// (and legacy v3) — never overwrite another execution context.
						if (
							(parsed?.v === 3 || parsed?.v === 4) &&
							Array.isArray(parsed.events)
						) {
							// Keep only OTHER contexts' segments — this context's old
							// segment is fully replaced by `current` (delivered events
							// stay removed), and tombstoned IDs (delivered or consent-
							// purged anywhere in this context) never resurrect.
							const tombstones = this.queue.recentlyRemovedIds();
							const others = (
								parsed.events as Array<{ owner?: string; eventId?: string }>
							).filter(
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
				await storage.setItem(
					this.queueStorageKey,
					JSON.stringify({ v: 4, events: merged }),
				);
			})
			.catch(() => {
				this.emit(
					"warn",
					"queue_persist_failed",
					"could not persist the queue",
				);
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
			if (parsed?.v !== 4 || !Array.isArray(parsed.events)) {
				throw new Error("unsupported queue state version");
			}
			for (const entry of parsed.events as unknown[]) {
				this.validatePersistedEntry(entry);
			}
			const adoptedIds: string[] = [];
			for (const entry of parsed.events as unknown[]) {
				const e = entry as {
					owner: string;
					kind: "event" | "identify";
					eventId: string;
					name?: string;
					occurredAt: number;
					serialized: string;
				};
				// Adoption: this context takes ownership of the restored entry —
				// it delivers it and its segment replaces the stale stored copy.
				adoptedIds.push(e.eventId);
				if (e.kind === "identify") {
					// F3: the serialized payload is a WireIdentifyOp, not an event
					// envelope — parsed for validation only; the entry is enqueued
					// verbatim. LIVE identity is never inferred from queued ops (F1).
					JSON.parse(e.serialized) as WireIdentifyOp;
					this.queue.enqueue({
						owner: this.instanceId,
						kind: "identify",
						eventId: e.eventId,
						timestamp: e.occurredAt,
						serialized: e.serialized,
					});
				} else {
					const envelope = JSON.parse(e.serialized) as WireEnvelope;
					this.queue.enqueue({
						owner: this.instanceId,
						kind: "event",
						eventId: e.eventId,
						name: e.name,
						properties: envelope.properties,
						timestamp: e.occurredAt,
						sessionId: envelope.sessionId,
						serialized: e.serialized,
					});
				}
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
		const expectedKeys = [
			"owner",
			"kind",
			"eventId",
			"occurredAt",
			"serialized",
		];
		const hasName = record.name !== undefined;
		if (
			Object.keys(record).length !==
			expectedKeys.length + (hasName ? 1 : 0)
		) {
			throw new Error("queue entry has unknown fields");
		}
		for (const key of expectedKeys) {
			if (!(key in record)) throw new Error("queue entry is missing fields");
		}
		if (record.kind !== "event" && record.kind !== "identify") {
			throw new Error("queue entry has an invalid kind");
		}
		const { owner, kind, eventId, occurredAt, serialized } = record;
		if (typeof owner !== "string" || owner.length === 0 || owner.length > 128) {
			throw new Error("queue entry has an invalid owner");
		}
		if (
			typeof eventId !== "string" ||
			eventId.length === 0 ||
			eventId.length > 128
		) {
			throw new Error("queue entry has an invalid event id");
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
		if (
			typeof serialized !== "string" ||
			utf8Length(serialized) > INGEST_LIMITS.maxEventBytes
		) {
			throw new Error("queue entry exceeds the event size ceiling");
		}
		// F3: branch by kind — identify entries carry a WireIdentifyOp and
		// intentionally have no event name.
		if (kind === "identify") {
			if (hasName)
				throw new Error("identify entries must not carry an event name");
			let op: WireIdentifyOp;
			try {
				op = JSON.parse(serialized) as WireIdentifyOp;
			} catch {
				throw new Error("queue identify entry has an unparsable payload");
			}
			if (
				typeof op.opId !== "string" ||
				op.opId.length === 0 ||
				op.opId.length > 128 ||
				op.opId !== eventId
			) {
				throw new Error("queue identify entry has an invalid op id");
			}
			if (
				typeof op.userId !== "string" ||
				op.userId.length === 0 ||
				op.userId.length > 256
			) {
				throw new Error("queue identify entry has an invalid user id");
			}
			if (
				typeof op.anonymousId !== "string" ||
				op.anonymousId.length === 0 ||
				op.anonymousId.length > 128
			) {
				throw new Error("queue identify entry has an invalid anonymous id");
			}
			if (
				typeof op.occurredAt !== "number" ||
				!Number.isFinite(op.occurredAt)
			) {
				throw new Error("queue identify entry has an invalid timestamp");
			}
			if (op.traits !== undefined) {
				const result = validateJsonValue(op.traits, {
					maxDepth: INGEST_LIMITS.maxPropertyDepth,
					maxStringLength: INGEST_LIMITS.maxStringLength,
					maxKeys: INGEST_LIMITS.maxPropertyKeys,
					maxArrayElements: INGEST_LIMITS.maxArrayElements,
				});
				if (!result.ok) {
					throw new Error(
						`queue identify entry has invalid traits (${result.reason})`,
					);
				}
			}
			if (
				op.unset !== undefined &&
				(!Array.isArray(op.unset) || op.unset.length > 50)
			) {
				throw new Error("queue identify entry has an invalid unset list");
			}
			return;
		}
		if (typeof record.name !== "string" || !isValidEventName(record.name)) {
			throw new Error("queue entry has an invalid event name");
		}
		const name = record.name;
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
				throw new Error(
					`queue entry has invalid properties (${result.reason})`,
				);
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
		bodyText: string | null,
	): Promise<{ kept: QueuedEvent[]; rejected: number } | "malformed" | null> {
		if (bodyText === null) return null; // unreadable body: status-only success
		let body: { results?: unknown };
		try {
			body = JSON.parse(bodyText) as { results?: unknown };
		} catch {
			return null; // non-JSON body: status-only success
		}
		if (!Array.isArray(body.results)) return null;
		// F2: an identity-only batch has no events to reconcile — the
		// response's identity outcomes are fire-and-forget (delivery is
		// retried by the op-id idempotency), so the empty results are fine.
		if (batch.length === 0) return { kept: [], rejected: 0 };
		const terminal = new Set<string>();
		const seen = new Set<string>();
		let rejected = 0;
		for (const entry of body.results) {
			const result = entry as { id?: unknown; status?: unknown } | null;
			if (
				!result ||
				typeof result.id !== "string" ||
				typeof result.status !== "string"
			) {
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
			const existing = await storage
				.getItem(ANONYMOUS_ID_KEY)
				.catch(() => null);
			if (existing && existing.length > 0 && existing.length <= 128) {
				// Reuse the stored identity — stable across launches.
				this.anonymousId = existing;
				return;
			}
			const fresh = this.runtime.createId();
			this.anonymousId = fresh;
			// canonical encoding: the raw string (F11) — never JSON-wrapped
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
export async function createPrismClient(
	options: PrismClientOptions,
): Promise<PrismClient> {
	const client = new PrismClientImpl(options);
	// Subscribe BEFORE ready() so initialization diagnostics (queue restore,
	// quarantine, purge) are observable through the public API.
	if (options.onDiagnostic) client.onDiagnostic(options.onDiagnostic);
	await client.ready();
	return client;
}
