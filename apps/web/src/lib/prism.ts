import { createBrowserClient } from "@prism/browser";
import type { PrismClient } from "@prism/core";

/**
 * v2 telemetry wiring for the Prism web product (task-9 slice 7): the
 * thin @prism/browser adapter over the @prism/core engine. The core owns
 * all queueing/consent/sanitization/authentication semantics; the browser
 * package supplies the runtime seam.
 *
 * Self-hosting constraint (task-5 section 1): NOTHING is emitted unless
 * the operator opts in with VITE_TELEMETRY_KEY (a project key of a Prism
 * instance they own). The endpoint is always the serving origin — never a
 * compiled-in host.
 */

let prism: PrismClient | null = null;

/**
 * One-time opt-in wiring; call from main.tsx. Without VITE_TELEMETRY_KEY
 * this is a no-op — a self-hosted deployment never contacts any host on
 * its own.
 */
export async function initTelemetry(): Promise<void> {
  const sourceKey = import.meta.env.VITE_TELEMETRY_KEY as string | undefined;
  if (!sourceKey || prism) return;
  try {
    prism = await createBrowserClient({
      sourceKey,
      endpoint: window.location.origin,
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
