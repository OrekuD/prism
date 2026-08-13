import {
  createPrismClient,
  type AnonymousPersistence,
  type CollectionState,
  type PrismClient,
  type PrismQueueOptions,
  type SanitizeOptions,
} from "@prism/core";
import { createBrowserRuntime } from "./browser-runtime";

export { capturePageContext } from "./browser-runtime";

export interface BrowserClientOptions {
  /** Project analytics key (public, write-only). */
  projectKey: string;
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
}

/**
 * Create the minimal browser client (task-9 §11): a thin runtime adapter
 * over the @prism/core engine. The core owns ALL queueing, consent,
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
): Promise<PrismClient> {
  if (typeof window === "undefined") {
    throw new Error(
      "@prism/browser requires a browser environment (window is undefined)",
    );
  }
  if (!options.endpoint || options.endpoint.trim().length === 0) {
    throw new Error("endpoint is required — choose the ingestion origin at runtime");
  }
  const runtime = createBrowserRuntime();
  return createPrismClient({
    projectKey: options.projectKey,
    endpoint: options.endpoint.replace(/\/$/, ""),
    runtime,
    collection: options.collection,
    queue: options.queue,
    sanitize: options.sanitize,
  });
}
