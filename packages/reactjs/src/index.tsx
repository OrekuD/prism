import type {
	GlobalPropertyResult,
	GlobalPropertyScope,
	IdentifyResult,
	JsonObject,
	JsonValue,
	PrismClient,
	PrismDiagnostic,
	PrismDiagnosticHandle,
	PrismErrorReporter,
	PrismSessionHandle,
	ResetResult,
} from "@prism-analytics/core";
import { errorToException } from "@prism-analytics/core";
import {
	Component,
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
} from "react";
import type { ErrorInfo, ReactNode } from "react";

/**
 * @prism-analytics/react — the thin provider/hook layer over @prism-analytics/core (task-9
 * §12). It must NOT create a second queue, session, event envelope,
 * consent store, or retry policy — the provider wraps an ALREADY-CREATED,
 * READY client so ownership and lifecycle stay explicit and non-React
 * code can create/own the same client.
 *
 * - The provider registers NO effects, listeners, or timers — React
 *   Strict Mode double-mounting can never duplicate work.
 * - Automatic route/page tracking is a later task.
 *
 * The package ALSO exports an OPT-IN <PrismErrorBoundary> (task-15 slice
 * 3b): a standalone class component that captures render/lifecycle errors
 * into an already-created reporter. It is off by default — nothing is
 * installed unless a consumer renders it. The core reporter lane is the
 * single source of consent/dedup/queueing semantics; the boundary is a
 * thin, zero-logic bridge (dedup coalesces Strict Mode double-captures).
 */

/** The stable imperative facade exposed by `usePrism`. */
export interface PrismReactFacade {
	/** The underlying ready client (for advanced use). */
	readonly client: PrismClient;
	/** Bound core methods — stable references across renders. */
	readonly track: (
		name: string,
		properties?: JsonObject,
	) => ReturnType<PrismClient["track"]>;
	readonly startSession: (options?: { properties?: JsonObject }) => ReturnType<
		PrismClient["startSession"]
	>;
	readonly identify: (
		userId: string,
		traits?: JsonObject,
	) => Promise<IdentifyResult>;
	readonly reset: () => Promise<ResetResult>;
	readonly setGlobalProperty: (
		key: string,
		value: JsonValue,
		scope?: GlobalPropertyScope,
	) => Promise<GlobalPropertyResult>;
	readonly unsetGlobalProperty: (
		key: string,
		scope?: GlobalPropertyScope,
	) => Promise<GlobalPropertyResult>;
	readonly clearGlobalProperties: (
		scope?: GlobalPropertyScope,
	) => Promise<GlobalPropertyResult>;
	readonly setCollectionState: (
		state: Parameters<PrismClient["setCollectionState"]>[0],
	) => Promise<void>;
	readonly flush: () => Promise<void>;
	readonly shutdown: (options?: { timeoutMs?: number }) => Promise<void>;
	readonly onDiagnostic: (
		listener: (diagnostic: PrismDiagnostic) => void,
	) => PrismDiagnosticHandle;
	/** Readonly observed collection state. */
	readonly collectionState: PrismClient["collectionState"];
	/** Readonly observed identity state (task-10). */
	readonly identity: PrismClient["identity"];
}

/** Context carries the READY client — never an initialization config. */
export const PrismContext = createContext<PrismClient | null>(null);

/** Context that optionally carries an already-created error reporter. */
export const PrismErrorBoundaryContext =
	createContext<PrismErrorReporter | null>(null);

export interface PrismProviderProps {
	/** An already-created, ready client (createPrismClient/createBrowserClient). */
	client: PrismClient;
	children?: ReactNode;
}

/** Zero-effect provider: publishes the ready client to the context. */
export function PrismProvider({ client, children }: PrismProviderProps) {
	const value = useMemo(() => client, [client]);
	return (
		<PrismContext.Provider value={value}>{children}</PrismContext.Provider>
	);
}

export interface PrismErrorBoundaryProviderProps {
	/** An already-created, ready error reporter (createBrowserErrorReporter). */
	reporter: PrismErrorReporter;
	children?: ReactNode;
}

/**
 * Zero-effect provider: publishes an already-created reporter so any
 * descendant <PrismErrorBoundary> (or the usePrismErrorReporter hook) can
 * share ONE reporter without prop-drilling. Strict Mode remounts are
 * harmless — this provider registers no effects or listeners.
 */
export function PrismErrorBoundaryProvider({
	reporter,
	children,
}: PrismErrorBoundaryProviderProps) {
	const value = useMemo(() => reporter, [reporter]);
	return (
		<PrismErrorBoundaryContext.Provider value={value}>
			{children}
		</PrismErrorBoundaryContext.Provider>
	);
}

/**
 * Returns the reporter from the nearest <PrismErrorBoundaryProvider>.
 * Throws a specific error outside a provider so misconfiguration is loud.
 */
export function usePrismErrorReporter(): PrismErrorReporter {
	const reporter = useContext(PrismErrorBoundaryContext);
	if (!reporter) {
		throw new Error(
			"usePrismErrorReporter must be used inside a <PrismErrorBoundaryProvider reporter={…}> with a ready reporter",
		);
	}
	return reporter;
}

function createFacade(client: PrismClient): PrismReactFacade {
	return {
		client,
		track: (name, properties) => client.track(name, properties),
		startSession: (options) => client.startSession(options),
		identify: (userId, traits) => client.identify(userId, traits),
		reset: () => client.reset(),
		setGlobalProperty: (key, value, scope) =>
			client.setGlobalProperty(key, value, scope),
		unsetGlobalProperty: (key, scope) => client.unsetGlobalProperty(key, scope),
		clearGlobalProperties: (scope) => client.clearGlobalProperties(scope),
		setCollectionState: (state) => client.setCollectionState(state),
		flush: () => client.flush(),
		shutdown: (options) => client.shutdown(options),
		onDiagnostic: (listener) => client.onDiagnostic(listener),
		// Getter (release review): a snapshot would go stale after consent
		// changes; React-side rerender subscriptions are a later concern.
		get collectionState() {
			return client.collectionState;
		},
		get identity() {
			return client.identity;
		},
	};
}

/**
 * Returns a STABLE facade over the client from the nearest PrismProvider.
 * Bound methods keep their identity across renders (no recreated
 * callbacks); throws a specific error outside a provider.
 *
 * Hooks cannot be wrapped in try/catch — if your tree may render without
 * a provider (progressive adoption, tests), use {@link useOptionalPrism}
 * instead and branch on the result BEFORE calling any other hook.
 */
export function usePrism(): PrismReactFacade {
	const client = useContext(PrismContext);
	if (!client) {
		throw new Error(
			"usePrism must be used inside a <PrismProvider client={…}> with a ready client",
		);
	}
	return useMemo(() => createFacade(client), [client]);
}

/**
 * Non-throwing variant of {@link usePrism}: returns the facade when a
 * provider is present, or `null` when one is not. Call this at the TOP of
 * the component and branch on the result — never inside conditionals or
 * try/catch blocks (Rules of Hooks).
 *
 * ```tsx
 * function AnalyticsButton() {
 *   const prism = useOptionalPrism();
 *   if (!prism) return <button>Checkout</button>;
 *   return <button onClick={() => prism.track("checkout")}>…</button>;
 * }
 * ```
 */
export function useOptionalPrism(): PrismReactFacade | null {
	const client = useContext(PrismContext);
	return useMemo(() => (client ? createFacade(client) : null), [client]);
}

/** Session handle type re-exported for consumers of the facade. */
export type { PrismSessionHandle };

/* ------------------------------------------------------------------ */
/* Task 17 §React integration: router-neutral manual page-view hook    */
/* ------------------------------------------------------------------ */

import type { BrowserPageViewOptions } from "@prism-analytics/core";

/**
 * Captures one page view for a normalized route on every path change.
 *
 * Contract (Task 17):
 * - Requires a ready BROWSER client from <PrismProvider> configured with
 *   `pageViews: { mode: "manual" }` — anything else throws a specific,
 * developer-actionable error (absent provider, core-only client, no page
 * tracking, history-mode ownership conflict).
 * - Accepts the route value from ANY router; never reads
 *   `location.search` or `location.hash` implicitly.
 * - React Strict Mode mount/unmount/remount produces ONE capture — the
 *   Browser tracker's client-level dedupe owns that boundary; this hook
 *   stays effect-minimal and never shuts down the shared client.
 */
export function usePrismPageView(options: {
	/** Developer-normalized route path starting at `/`. */
	readonly path: string;
	/** Optional title override (respects the client's captureTitle policy). */
	readonly title?: string;
}): void {
	const client = useContext(PrismContext);
	if (!client) {
		throw new Error(
			"usePrismPageView must be used inside <PrismProvider client={…}>",
		);
	}
	const browserClient = client as unknown as {
		pageViews?: {
			mode: "history" | "manual";
			capture(input?: { path?: string; title?: string }): unknown;
		} | null;
	};
	const controller = browserClient.pageViews ?? null;
	if (!controller) {
		throw new Error(
			"usePrismPageView requires createBrowserClient({ pageViews: … }) — this client has no page tracking",
		);
	}
	if (controller.mode !== "manual") {
		throw new Error(
			'usePrismPageView requires pageViews mode "manual" — history-mode clients capture navigation automatically',
		);
	}
	const pathRef = useRef(options.path);
	useEffect(() => {
		// Fire per committed path change; the tracker dedupes Strict Mode's
		// synchronous double-invoke of this effect.
		void pathRef.current;
		controller.capture({ path: options.path, title: options.title });
	}, [options.path]); // eslint-disable-line react-hooks/exhaustive-deps -- title follows path commits
}

/**
 * Type guard: narrows a facade/client to the Browser surface when it was
 * created by createBrowserClient with pageViews configured.
 */
export function hasBrowserPageViews(client: unknown): boolean {
	const candidate = client as { pageViews?: unknown } | null | undefined;
	return (
		!!candidate &&
		typeof candidate.pageViews === "object" &&
		candidate.pageViews !== null
	);
}
export type { BrowserPageViewOptions as PrismBrowserPageViewOptions };

const COMPONENT_STACK_LIMIT = 8_000;

/** The boundary's captured-error state — null means "rendering normally". */
interface PrismErrorBoundaryState {
	error: Error | null;
}

/** `fallback` may be static ReactNode or a function receiving (error, reset). */
export type PrismErrorBoundaryFallback =
	| ReactNode
	| ((error: Error, reset: () => void) => ReactNode);

export interface PrismErrorBoundaryProps {
	/**
	 * An ALREADY-CREATED, ready error reporter (createBrowserErrorReporter).
	 * Optional when the boundary sits under a <PrismErrorBoundaryProvider>.
	 */
	reporter?: PrismErrorReporter;
	/** Rendered when an error is captured. Defaults to `null`. */
	fallback?: PrismErrorBoundaryFallback;
	/** Side-effect hook (e.g. UI toast) called after the capture is enqueued. */
	onCapture?: (error: Error, info: ErrorInfo) => void;
	children?: ReactNode;
}

/**
 * OPT-IN error boundary (task-15 slice 3b). Catches RENDER + lifecycle
 * errors in its own descendant tree and enqueues them into the reporter
 * with `handled: true` plus a bounded component stack — a thin, zero-logic
 * bridge. It never rethrows and never installs anything globally.
 *
 * Honest boundary limits (task-15 slice 3e): it does NOT catch asynchronous
 * errors, promise rejections, timers, event-handler errors, or errors in
 * OTHER trees. Those are captured explicitly (reporter.captureException)
 * or by the browser global handlers (createBrowserErrorReporter's opt-in
 * install()). Do not claim otherwise.
 *
 * React Strict Mode double-renders; if a crash is captured twice inside a
 * strict subtree, the reporter's dedupe window (browser adapter, default
 * 1s) collapses the duplicate into one, so Strict Mode never double-reports
 * a single boundary error. A failing reporter must never break the
 * boundary, so the capture call is guarded.
 */
export class PrismErrorBoundary extends Component<
	PrismErrorBoundaryProps,
	PrismErrorBoundaryState
> {
	state: PrismErrorBoundaryState = { error: null };

	static contextType = PrismErrorBoundaryContext;

	/** The reporter: explicit prop wins; otherwise the provider context. */
	private resolvedReporter(): PrismErrorReporter {
		if (this.props.reporter) return this.props.reporter;
		const fromContext = this.context as PrismErrorReporter | null;
		if (fromContext) return fromContext;
		throw new Error(
			"PrismErrorBoundary needs a reporter prop or a <PrismErrorBoundaryProvider reporter={…}> ancestor",
		);
	}

	static getDerivedStateFromError(error: Error): PrismErrorBoundaryState {
		return { error };
	}

	componentDidCatch(error: Error, info: ErrorInfo): void {
		this.props.onCapture?.(error, info);
		try {
			this.resolvedReporter().captureException({
				exception: errorToException(error),
				handled: true,
				context: {
					extras: {
						boundary: "PrismErrorBoundary",
						componentStack: (info.componentStack ?? "").slice(
							0,
							COMPONENT_STACK_LIMIT,
						),
					},
				},
			});
		} catch {
			// a failing reporter must never break the boundary
		}
	}

	/** Re-render the subtree (the fallback calls this to recover). */
	reset = (): void => {
		this.setState({ error: null });
	};

	render(): ReactNode {
		const error = this.state.error;
		if (error === null) return this.props.children;
		const fallback = this.props.fallback;
		if (fallback) {
			return typeof fallback === "function"
				? fallback(error, this.reset)
				: fallback;
		}
		return null;
	}
}
