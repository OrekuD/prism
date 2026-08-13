import type {
  PrismLifecycle,
  PrismLifecycleEvent,
  PrismRuntimeAdapter,
  PrismRuntimeContext,
  PrismStorage,
} from "@prism/core";

/**
 * Browser runtime internals for @prism/browser (task-9 §11). Every
 * platform primitive is accessed INSIDE these functions — importing this
 * module in Node never touches `window`, and the factory fails loudly
 * outside a browser instead of half-working.
 */

/** A collision-resistant ID; crypto.randomUUID may be absent on insecure origins. */
function browserCreateId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `prism-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/**
 * Storage adapter with a per-execution-context namespace for queues
 * (release review): queue snapshots live in SESSION storage — one
 * namespace per tab, surviving reloads — so two tabs sharing an origin
 * can never clobber each other's persisted queue. The anonymous identity
 * stays in LOCAL storage (one shared origin identity across tabs, the
 * documented segment-style decision). Returns undefined when storage is
 * denied (privacy modes, quota errors) — the core then falls back to
 * its in-memory queue, never a crash.
 */
export function createBrowserStorage(): PrismStorage | undefined {
  try {
    const probe = "__prism_storage_probe__";
    window.sessionStorage.setItem(probe, "1");
    window.sessionStorage.removeItem(probe);
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
  } catch {
    return undefined;
  }
  const storeFor = (key: string): Storage =>
    key.startsWith("prism:queue:") ? window.sessionStorage : window.localStorage;
  return {
    getItem: async (key) => {
      try {
        return storeFor(key).getItem(key);
      } catch {
        return null;
      }
    },
    setItem: async (key, value) => {
      storeFor(key).setItem(key, value);
    },
    removeItem: async (key) => {
      storeFor(key).removeItem(key);
    },
  };
}

/**
 * Lifecycle seam: visibilitychange → foreground/background,
 * beforeunload → before-unload (the core requests a bounded flush; the
 * transport is an authenticated fetch keepalive so unload flushes carry
 * the write key — never an unauthenticated sendBeacon fallback).
 * Global listeners fire into empty sets after shutdown (harmless); the
 * core's per-subscription removers are the deterministic cleanup.
 */
export function createBrowserLifecycle(): PrismLifecycle {
  const listeners: Record<PrismLifecycleEvent, Set<() => void>> = {
    foreground: new Set(),
    background: new Set(),
    "before-unload": new Set(),
  };

  const fire = (event: keyof typeof listeners): void => {
    for (const listener of listeners[event]) listener();
  };
  const onVisibility = (): void => {
    fire(document.visibilityState === "visible" ? "foreground" : "background");
  };
  const onBeforeUnload = (): void => fire("before-unload");

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("beforeunload", onBeforeUnload);

  return {
    on(event, listener) {
      listeners[event].add(listener);
      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        listeners[event].delete(listener);
      };
    },
  };
}

/**
 * The minimal APPROVED browser context (§11): platform/kind, viewport
 * size, locale, timezone. NO user-agent capture (the server sees the
 * request UA naturally and no v2 report needs a second copy), no DOM
 * content, form values, or click targets.
 */
export function captureBrowserContext(): PrismRuntimeContext {
  const context: {
    platform: string;
    kind: "web" | "server" | "mobile";
    screenSize?: { width: number; height: number };
    locale?: string;
    timezone?: string;
  } = {
    platform: "browser",
    kind: "web",
  };
  const width = window.innerWidth || window.screen?.width || 0;
  const height = window.innerHeight || window.screen?.height || 0;
  if (width > 0 && height > 0) {
    context.screenSize = { width, height };
  }
  const locale = navigator.language;
  if (locale) context.locale = locale;
  try {
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (timezone) context.timezone = timezone;
  } catch {
    // Intl unavailable — context stays minimal.
  }
  return context;
}

/**
 * Sanitized page identity for explicit tracking (§11): the PATH ONLY —
 * query strings and hashes are excluded — and the referrer ORIGIN only
 * (never a full URL with query parameters). Returned as plain data so
 * callers decide where to attach it; automatic route tracking is a later
 * task.
 */
export function capturePageContext(): { path: string; referrer: string | null } {
  let path = "/";
  try {
    path = window.location.pathname || "/";
  } catch {
    // keep "/"
  }
  let referrer: string | null = null;
  try {
    const raw = document.referrer;
    if (raw) referrer = new URL(raw).origin;
  } catch {
    referrer = null;
  }
  return { path, referrer };
}

/** Assemble the full browser runtime adapter. */
export function createBrowserRuntime(): PrismRuntimeAdapter {
  const storage = createBrowserStorage();
  return {
    name: "browser",
    now: () => Date.now(),
    createId: browserCreateId,
    transport: {
      post: (url, request) => {
        // REAL cancellation (release review): the core's PrismSignal is
        // bridged to a genuine AbortController, and the configured
        // request timeout schedules an abort of its own. A timeout abort
        // is a genuine delivery failure for the core's retry policy.
        const controller = new AbortController();
        const onCoreAbort = (): void => controller.abort();
        request.signal.addEventListener("abort", onCoreAbort);
        const timer = window.setTimeout(() => controller.abort(), request.timeoutMs);

        // keepalive only within the browser's ~64 KiB budget: large valid
        // batches must not silently fail (or drop auth) at unload time.
        const bodyBytes = new TextEncoder().encode(request.body).length;
        const keepalive = bodyBytes <= 64 * 1024;

        return fetch(url, {
          method: "POST",
          headers: { ...request.headers },
          body: request.body,
          signal: controller.signal,
          keepalive,
        })
          .then(async (response) => ({
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            text: () => response.text(),
          }))
          .finally(() => {
            window.clearTimeout(timer);
            request.signal.removeEventListener("abort", onCoreAbort);
          });
      },
    },
    schedule: (delayMs, callback) => {
      const handle = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(handle);
    },
    context: captureBrowserContext(),
    lifecycle: createBrowserLifecycle(),
    ...(storage ? { storage } : {}),
  };
}
