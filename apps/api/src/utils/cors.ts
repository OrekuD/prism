import type { Bindings } from "../types/types";

/**
 * Origins allowed to make credentialed requests to the API.
 *
 * - CLIENT_URL + CORS_ALLOWED_ORIGINS form the explicit allowlist.
 * - In ENVIRONMENT=development any localhost/127.0.0.1 port is trusted, so
 *   dev servers on any port work without CORS surprises. Production stays
 *   locked to the explicit allowlist.
 */
const DEV_LOCALHOST_ORIGIN = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

export function resolveAllowedOrigins(env: Bindings): string[] {
  return [
    ...new Set(
      [
        env.CLIENT_URL,
        ...(env.CORS_ALLOWED_ORIGINS ?? "")
          .split(",")
          .map((entry) => entry.trim())
          .filter(Boolean),
      ].filter((entry): entry is string => Boolean(entry)),
    ),
  ];
}

export function isOriginAllowed(origin: string, env: Bindings): boolean {
  if (resolveAllowedOrigins(env).includes(origin)) {
    return true;
  }
  return (
    env.ENVIRONMENT === "development" && DEV_LOCALHOST_ORIGIN.test(origin)
  );
}
