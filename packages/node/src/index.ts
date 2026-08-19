import type { NodeCaptureOptions, NodeErrorReporter } from "./error-reporter";
export { createNodeErrorReporter } from "./error-reporter";
export { normalizeNodeErrorValue } from "./error-reporter";
export { framesFromStack } from "@prism-analytics/core";
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
