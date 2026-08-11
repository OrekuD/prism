import { createAuthClient } from "better-auth/react";
import { jwtClient } from "better-auth/client/plugins";

/**
 * Single Better Auth browser client.
 *
 * The API serves cookies on the same site; the dashboard talks to it
 * cross-origin in local development, so credentials must be included and
 * the base URL must be deployment-aware.
 */
import { API_BASE_URL } from "@/lib/api";
export const authBaseUrl = API_BASE_URL.replace(/\/api\/v1\/?$/, "");

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
/**
 * Requests a fresh verification email for the signed-in user's address.
 * The endpoint is session-authenticated; the server never reveals whether
 * an address exists (anti-enumeration), so failures surface as generic
 * errors only when the request itself is rejected.
 */
export async function resendVerificationEmail(
  email: string,
): Promise<void> {
  const response = await fetch(
    `${authBaseUrl}/api/auth/send-verification-email`,
    {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email }),
    },
  );

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { message?: string }
      | null;
    throw new Error(body?.message ?? `Request failed (${response.status})`);
  }
}

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
