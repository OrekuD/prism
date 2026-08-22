import {
	type AnonymousPersistence,
	type BrowserPageViewOptions,
	type CaptureResult,
	type CollectionState,
	type ErrorBeforeSend,
	type ErrorReporterShare,
	type PrismClient,
	type PrismQueueOptions,
	type SanitizeOptions,
	createPrismClient,
} from "@prism-analytics/core";
import { createBrowserRuntime } from "./browser-runtime";
import {
	type BrowserCaptureResult,
	type BrowserErrorReporter,
	type BrowserErrorReporterOptions,
	type ErrorCaptureOptions,
	createBrowserErrorReporter,
} from "./error-reporter";
import {
	type BrowserPageViewController,
	createPageTracker,
} from "./page-tracker";

export { capturePageContext } from "./browser-runtime";
export type { BrowserPageViewOptions } from "@prism-analytics/core";
export type { BrowserPageViewController } from "./page-tracker";
export {
	createBrowserErrorReporter,
	normalizeErrorValue,
} from "./error-reporter";
export { framesFromStack } from "@prism-analytics/core";
export type {
	BrowserErrorReporter,
	BrowserErrorReporterOptions,
	BrowserCaptureResult,
	ErrorCaptureOptions,
} from "./error-reporter";
export type {
	ErrorBeforeSend,
	ErrorReporterShare,
} from "@prism-analytics/core";

export interface BrowserClientOptions {
	/** Source ingestion key (publishable, write-only). */
	sourceKey: string;
	/**
	 * Ingestion origin chosen at runtime (hosted or self-hosted) — REQUIRED,
	 * never compiled into the package (task-9 §11).
	 */
	endpoint: string;
	/** Privacy/collection configuration (explicit consent, like the core). */
	collection: {
		initialState: CollectionState;
		anonymousPersistence?: AnonymousPersistence;
	};
	queue?: PrismQueueOptions;
	sanitize?: SanitizeOptions;
	/**
	 * Task 17: explicit Web page-view tracking. Omitted (or undefined) means
	 * the client captures NO page views and exposes `pageViews: null`.
	 */
	pageViews?: BrowserPageViewOptions;
}

/**
 * The Browser client surface: everything PrismClient promises plus a
 * stable page controller when (and only when) pageViews is configured.
 */
export type BrowserPrismClient = PrismClient & {
	readonly pageViews: {
		readonly mode: "history" | "manual";
		capture(input?: { path?: string; title?: string }): CaptureResult;
	} | null;
};

/**
 * Create the minimal browser client (task-9 §11): a thin runtime adapter
 * over the @prism-analytics/core engine. The core owns ALL queueing, consent,
 * sanitization, session, authentication, and retry semantics — this
 * package only translates browser primitives (fetch transport, local
 * storage, timers, lifecycle events) into the runtime seam.
 *
 * - Fails loudly outside a browser (no half-working Node import).
 * - Requires an explicit runtime `endpoint`.
 * - Storage denial (privacy modes) degrades to the core's in-memory
 *   queue — never a crash.
 * - Unload flushes use an AUTHENTICATED fetch keepalive — never an
 *   unauthenticated sendBeacon fallback.
 */
export async function createBrowserClient(
	options: BrowserClientOptions,
): Promise<BrowserPrismClient> {
	if (typeof window === "undefined") {
		throw new Error(
			"@prism-analytics/browser requires a browser environment (window is undefined)",
		);
	}
	if (!options.endpoint || options.endpoint.trim().length === 0) {
		throw new Error(
			"endpoint is required — choose the ingestion origin at runtime",
		);
	}
	const runtime = createBrowserRuntime();
	const client = await createPrismClient({
		sourceKey: options.sourceKey,
		endpoint: options.endpoint.replace(/\/$/, ""),
		runtime,
		collection: {
			// Session-scoped identity by default (§4): the browser default
			// keeps the anonymous ID for the client lifetime unless the caller
			// explicitly asks for persistent identity.
			anonymousPersistence: "session",
			...options.collection,
		},
		queue: options.queue,
		sanitize: options.sanitize,
	});

	// Task 17 §2: the Browser layer owns navigation + Web sessions; Core
	// stays runtime-neutral. The controller is attached ONLY when configured
	// so existing consumers keep a PrismClient-compatible instance with
	// `pageViews: null`.
	const browserClient = client as unknown as {
		pageViews: BrowserPrismClient["pageViews"];
		shutdown: BrowserPrismClient["shutdown"];
	} & PrismClient;
	if (!options.pageViews) {
		browserClient.pageViews = null;
		return browserClient as BrowserPrismClient;
	}
	const coreClient: PrismClient = client;
	const tracker = createPageTracker({
		client: coreClient,
		options: options.pageViews,
		sourceKey: options.sourceKey,
		endpoint: options.endpoint.replace(/\/$/, ""),
	});
	browserClient.pageViews = {
		mode: tracker.mode,
		capture: (input?: { path?: string; title?: string }) =>
			tracker.capture(input),
	};
	// Shutdown detaches History listeners; persisted Web-session state
	// intentionally survives so the next hard navigation resumes.
	const originalShutdown = client.shutdown.bind(client);
	browserClient.shutdown = async (shutdownOptions?: { timeoutMs?: number }) => {
		tracker.dispose();
		return originalShutdown(shutdownOptions);
	};
	return browserClient;
}
