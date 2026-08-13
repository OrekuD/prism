import { createContext, useContext, useMemo } from "react";
import type { ReactNode } from "react";
import type {
  JsonObject,
  PrismClient,
  PrismDiagnostic,
  PrismDiagnosticHandle,
  PrismSessionHandle,
} from "@prism/core";

/**
 * @prism/react — the thin provider/hook layer over @prism/core (task-9
 * §12). It must NOT create a second queue, session, event envelope,
 * consent store, or retry policy — the provider wraps an ALREADY-CREATED,
 * READY client so ownership and lifecycle stay explicit and non-React
 * code can create/own the same client.
 *
 * - The provider registers NO effects, listeners, or timers — React
 *   Strict Mode double-mounting can never duplicate work.
 * - It is NOT an error boundary or an exception SDK, and it performs no
 *   console-only error handling.
 * - Automatic route/page tracking is a later task.
 */

/** The stable imperative facade exposed by `usePrism`. */
export interface PrismReactFacade {
  /** The underlying ready client (for advanced use). */
  readonly client: PrismClient;
  /** Bound core methods — stable references across renders. */
  readonly track: (name: string, properties?: JsonObject) => ReturnType<PrismClient["track"]>;
  readonly startSession: (options?: { properties?: JsonObject }) => ReturnType<PrismClient["startSession"]>;
  readonly setCollectionState: (state: Parameters<PrismClient["setCollectionState"]>[0]) => Promise<void>;
  readonly flush: () => Promise<void>;
  readonly shutdown: (options?: { timeoutMs?: number }) => Promise<void>;
  readonly onDiagnostic: (listener: (diagnostic: PrismDiagnostic) => void) => PrismDiagnosticHandle;
  /** Readonly observed collection state. */
  readonly collectionState: PrismClient["collectionState"];
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
    setCollectionState: (state) => client.setCollectionState(state),
    flush: () => client.flush(),
    shutdown: (options) => client.shutdown(options),
    onDiagnostic: (listener) => client.onDiagnostic(listener),
    // Getter (release review): a snapshot would go stale after consent
    // changes; React-side rerender subscriptions are a later concern.
    get collectionState() {
      return client.collectionState;
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
