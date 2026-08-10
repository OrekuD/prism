/**
 * Runtime instance configuration (task-6 section 4): fetched from the
 * public GET /api/v1/config endpoint so the dashboard adapts to the
 * deployment it is served by (instance name, signup policy, providers)
 * instead of compile-time assumptions.
 */

export type RuntimeConfig = {
  deploymentMode: "hosted" | "self-hosted";
  instanceName: string;
  signupPolicy: "open" | "invite-only" | "disabled";
  baseUrl: string;
  /** Self-hosted instance with no users yet: the first-owner setup is open. */
  setupRequired: boolean;
  providers: { github: boolean; google: boolean };
  mailConfigured: boolean;
};

const FALLBACK: RuntimeConfig = {
  deploymentMode: "hosted",
  instanceName: "Prism",
  signupPolicy: "open",
  baseUrl: import.meta.env.VITE_API_URL ?? "http://localhost:8787",
  setupRequired: false,
  providers: { github: false, google: false },
  mailConfigured: false,
};

let cached: RuntimeConfig | null = null;

export async function loadRuntimeConfig(): Promise<RuntimeConfig> {
  if (cached) return cached;
  try {
    const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
    const response = await fetch(`${apiUrl}/api/v1/config`, {
      credentials: "include",
    });
    if (!response.ok) return FALLBACK;
    cached = (await response.json()) as RuntimeConfig;
    return cached;
  } catch {
    return FALLBACK;
  }
}
