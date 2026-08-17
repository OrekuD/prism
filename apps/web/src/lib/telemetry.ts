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

import type { JsonObject } from "@prism-analytics/core";
import { telemetryClient } from "./prism";

/**
 * Fire-and-forget, error-contained, no-op unless the operator opted in
 * with VITE_TELEMETRY_KEY. track() is synchronous — the v2 core queues the
 * event and flushes in the background.
 */
export function trackTelemetry(
  event: TelemetryEvent,
  data?: Record<string, unknown>,
): void {
  const client = telemetryClient();
  if (!client) return;
  try {
    client.track(event, data as JsonObject | undefined);
  } catch {
    // Validation rejections are intentionally silent for product telemetry.
  }
}
