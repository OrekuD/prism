import { createPrismClient, type PrismClient, type PrismRuntimeAdapter } from "@prism/core";

/**
 * Interim v2 telemetry wiring for the Prism web product (task-9 slice 6).
 *
 * The v1 client and its @prism/react provider were removed in this slice;
 * until the dedicated @prism/browser adapter lands (slice 7), the product
 * app constructs a v2 client with a small inline browser runtime. The
 * core owns all queueing/consent/sanitization/authentication semantics —
 * this file only translates browser primitives into the runtime seam.
 *
 * Self-hosting constraint (task-5 section 1): NOTHING is emitted unless
 * the operator opts in with VITE_TELEMETRY_KEY (a project key of a Prism
 * instance they own). The endpoint is always the serving origin — never a
 * compiled-in host.
 */

function createBrowserRuntime(): PrismRuntimeAdapter {
  return {
    name: "browser-interim",
    now: () => Date.now(),
    createId: () => crypto.randomUUID(),
    transport: {
      post: (url, request) =>
        fetch(url, {
          method: "POST",
          headers: { ...request.headers },
          body: request.body,
          signal: request.signal as AbortSignal,
        }).then(async (response) => ({
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          text: () => response.text(),
        })),
    },
    schedule: (delayMs, callback) => {
      const handle = window.setTimeout(callback, delayMs);
      return () => window.clearTimeout(handle);
    },
    context: { platform: "browser", kind: "web" },
    lifecycle: {
      on: (event, listener) => {
        if (event !== "before-unload") return () => undefined;
        window.addEventListener("beforeunload", listener);
        return () => window.removeEventListener("beforeunload", listener);
      },
    },
  };
}

let prism: PrismClient | null = null;

/**
 * One-time opt-in wiring; call from main.tsx. Without VITE_TELEMETRY_KEY
 * this is a no-op — a self-hosted deployment never contacts any host on
 * its own.
 */
export async function initTelemetry(): Promise<void> {
  const projectKey = import.meta.env.VITE_TELEMETRY_KEY as string | undefined;
  if (!projectKey || prism) return;
  try {
    prism = await createPrismClient({
      projectKey,
      endpoint: window.location.origin,
      runtime: createBrowserRuntime(),
      collection: { initialState: "granted", anonymousPersistence: "none" },
    });
  } catch {
    // Telemetry is best-effort: a bad key or runtime never breaks the app.
    prism = null;
  }
}

/** The client (testable seam for the telemetry module). */
export function telemetryClient(): PrismClient | null {
  return prism;
}
