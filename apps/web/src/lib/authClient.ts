import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

/**
 * Single Better Auth browser client.
 *
 * The API serves cookies on the same site; the dashboard talks to it
 * cross-origin in local development, so credentials must be included and
 * the base URL must be deployment-aware.
 */
const apiUrl = import.meta.env.VITE_API_URL ?? "http://localhost:8787";
export const authBaseUrl = apiUrl.replace(/\/api\/v1\/?$/, "");

export const authClient = createAuthClient({
  baseURL: authBaseUrl,
  plugins: [jwtClient()],
  fetchOptions: {
    credentials: "include",
  },
});

/**
 * Requests a short-lived service JWT for the analytics WebSocket from the
 * Better Auth JWT plugin (GET /api/auth/token). The cookie session is the
 * primary credential; the returned token is issuer/audience-bound and
 * expires in ~15 minutes.
 */
export async function getServiceToken(): Promise<string | null> {
  try {
    const response = await fetch(`${authBaseUrl}/api/auth/token`, {
      credentials: "include",
    });
    if (!response.ok) {
      return null;
    }
    const data = (await response.json()) as { token?: string };
    return data.token ?? null;
  } catch {
    return null;
  }
}

export type EnabledProviders = { github: boolean; google: boolean };

/** Reads which social providers the API has credentials for. */
export async function fetchEnabledProviders(): Promise<EnabledProviders> {
  try {
    const response = await fetch(`${authBaseUrl}/api/auth/providers`);
    if (!response.ok) {
      return { github: false, google: false };
    }
    return (await response.json()) as EnabledProviders;
  } catch {
    return { github: false, google: false };
  }
}
