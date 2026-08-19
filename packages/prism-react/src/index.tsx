import { Component, createContext, useContext, useMemo } from "react";
import type { ErrorInfo, ReactNode } from "react";
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
  readonly track: (name: string, properties?: JsonObject) => ReturnType<PrismClient["track"]>;
  readonly startSession: (options?: { properties?: JsonObject }) => ReturnType<PrismClient["startSession"]>;
  readonly identify: (userId: string, traits?: JsonObject) => Promise<IdentifyResult>;
  readonly reset: () => Promise<ResetResult>;
  readonly setGlobalProperty: (
    key: string,
    value: JsonValue,
    scope?: GlobalPropertyScope,
  ) => Promise<GlobalPropertyResult>;
  readonly unsetGlobalProperty: (key: string, scope?: GlobalPropertyScope) => Promise<GlobalPropertyResult>;
  readonly clearGlobalProperties: (scope?: GlobalPropertyScope) => Promise<GlobalPropertyResult>;
  readonly setCollectionState: (state: Parameters<PrismClient["setCollectionState"]>[0]) => Promise<void>;
  readonly flush: () => Promise<void>;
  readonly shutdown: (options?: { timeoutMs?: number }) => Promise<void>;
  readonly onDiagnostic: (listener: (diagnostic: PrismDiagnostic) => void) => PrismDiagnosticHandle;
  /** Readonly observed collection state. */
  readonly collectionState: PrismClient["collectionState"];
  /** Readonly observed identity state (task-10). */
  readonly identity: PrismClient["identity"];
}

/** Context carries the READY client — never an initialization config. */
export const PrismContext = createContext<PrismClient | null>(null);

export interface PrismProviderProps {
  /** An already-created, ready client (createPrismClient/createBrowserClient). */
  client: PrismClient;
  children?: ReactNode;
}

/** Zero-effect provider: publishes the ready client to the context. */
export function PrismProvider({ client, children }: PrismProviderProps) {
  const value = useMemo(() => client, [client]);
  return <PrismContext.Provider value={value}>{children}</PrismContext.Provider>;
}

function createFacade(client: PrismClient): PrismReactFacade {
  return {
    client,
    track: (name, properties) => client.track(name, properties),
    startSession: (options) => client.startSession(options),
    identify: (userId, traits) => client.identify(userId, traits),
    reset: () => client.reset(),
    setGlobalProperty: (key, value, scope) => client.setGlobalProperty(key, value, scope),
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

/** Session handle type re-exported for consumers of the facade. */
export type { PrismSessionHandle };

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
  /** An ALREADY-CREATED, ready error reporter (createBrowserErrorReporter). */
  reporter: PrismErrorReporter;
  /** Rendered when an error is captured. Defaults to `null`. */
  fallback?: PrismErrorBoundaryFallback;
  /** Side-effect hook (e.g. UI toast) called after the capture is enqueued. */
  onCapture?: (error: Error, info: ErrorInfo) => void;
  children?: ReactNode;
}

/**
 * OPT-IN error boundary (task-15 slice 3b). Catches render/lifecycle
 * errors and enqueues them into the reporter with `handled: true` plus a
 * bounded component stack — a thin, zero-logic bridge. It never rethrows
 * and never installs anything globally; React Strict Mode double-captures
 * are coalesced by the reporter's dedupe window. A failing reporter must
 * never break the boundary, so the capture call is guarded.
 */
export class PrismErrorBoundary extends Component<
  PrismErrorBoundaryProps,
  PrismErrorBoundaryState
> {
  state: PrismErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): PrismErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.props.onCapture?.(error, info);
    try {
      this.props.reporter.captureException({
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
