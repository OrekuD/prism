/**
 * Prism product telemetry (task-5 section 1): intentional event names for
 * the product's own UX, without collecting sensitive form content.
 *
 * Self-hosting constraint: nothing is emitted unless the operator opts in
 * with VITE_TELEMETRY_KEY (a project key of a Prism instance they own).
 * Default is a no-op, so a self-hosted deployment never contacts Prism
 * cloud or any third party on its own.
 */

export const TELEMETRY_EVENTS = {
  signupMethod: "prism.signup_method",
  onboardingStep: "prism.onboarding_step",
  docsClick: "prism.docs_click",
  firstEventSuccess: "prism.first_event_success",
} as const;

export type TelemetryEvent =
  (typeof TELEMETRY_EVENTS)[keyof typeof TELEMETRY_EVENTS];

let client: { logEvent: (name: string, data?: Record<string, unknown>) => Promise<void> } | null = null;

/** One-time opt-in wiring; call from main.tsx when a key is configured. */
export function enableTelemetry(
  prism: { logEvent: (name: string, data?: Record<string, unknown>) => Promise<void> },
): void {
  client = prism;
}

/** Fire-and-forget, error-contained, no-op unless enabled. */
export function trackTelemetry(
  event: TelemetryEvent,
  data?: Record<string, unknown>,
): void {
  if (!client) return;
  client.logEvent(event, data).catch(() => undefined);
}
