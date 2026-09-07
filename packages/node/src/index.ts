import type { NodeCaptureOptions, NodeErrorReporter } from "./error-reporter";
export { createNodeErrorReporter } from "./error-reporter";
export { normalizeNodeErrorValue } from "./error-reporter";
export { framesFromStack } from "@prism-analytics/core";
import {
  createPrismClient,
  type PrismClient,
  type PrismQueueOptions,
  type SanitizeOptions,
  type CollectionState,
} from "@prism-analytics/core";
import { createNodeRuntime } from "./node-runtime";
export type {
	NodeErrorReporter,
	NodeErrorReporterOptions,
	NodeCaptureOptions,
} from "./error-reporter";
export type {
	ErrorBeforeSend,
	ErrorReporterShare,
	PrismResponse,
} from "@prism-analytics/core";

export interface NodeErrorMiddlewareResult {
	/** The value to rethrow (the application owns control flow). */
	error: unknown;
	/** True when the value was genuinely captured for delivery. */
	captured: boolean;
}

/**
 * Framework-agnostic request error helper (task-15 "framework integration
 * after the base Node adapter has a stable lifecycle"). Node is concurrent,
 * so there is intentionally NO ambient request context — pass `context`
 * explicitly. Wrap your handler body (Hono, Express, Fastify, plain http)
 * with this to capture a thrown error with per-request tags:
 *
 * ```ts
 * app.onError((err, c) => {
 *   reportError(reporter, err, { handled: false, context: { tags: { route: c.req.path } } });
 *   return c.json({ error: "internal" }, 500);
 * });
 * ```
 */
export function reportError(
	reporter: NodeErrorReporter,
	value: unknown,
	options?: NodeCaptureOptions,
): NodeErrorMiddlewareResult {
	let captured = false;
	try {
		const result = reporter.captureException(value, options);
		captured = result.status === "queued";
	} catch {
		// A malformed caller layout must never crash request handling.
		captured = false;
	}
	return { error: value, captured };
}

export interface NodeClientOptions {
  sourceKey: string;
  endpoint: string;
  collection: { initialState: CollectionState };
  queue?: PrismQueueOptions;
  sanitize?: SanitizeOptions;
}

export type NodePrismClient = PrismClient;

/**
 * Create a Node/server analytics client (task-19).
 * Thin wrapper over `createPrismClient` + `createNodeRuntime` — no second
 * queue, no storage, no lifecycle handlers. Requires explicit endpoint,
 * sourceKey, and collection.initialState. The per-call `actor: { userId }`
 * path is the concurrency-safe way to attribute events in a shared process.
 */
export async function createNodeClient(
  options: NodeClientOptions,
): Promise<NodePrismClient> {
  if (!options.sourceKey || options.sourceKey.trim().length === 0) {
    throw new Error("sourceKey is required");
  }
  if (!options.endpoint || options.endpoint.trim().length === 0) {
    throw new Error("endpoint is required");
  }
  if (
    !options.collection ||
    (options.collection.initialState !== "pending" &&
      options.collection.initialState !== "granted" &&
      options.collection.initialState !== "denied")
  ) {
    throw new Error("collection.initialState must be pending, granted, or denied");
  }
  const runtime = createNodeRuntime();
  const client = await createPrismClient({
    sourceKey: options.sourceKey,
    endpoint: options.endpoint,
    runtime,
    collection: options.collection,
    ...(options.queue ? { queue: options.queue } : {}),
    ...(options.sanitize ? { sanitize: options.sanitize } : {}),
  });
  return client as NodePrismClient;
}
