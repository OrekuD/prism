/**
 * API base URL resolution (task-6 section 2: same-origin routing).
 *
 * The built web image is served behind the reverse proxy and talks to the
 * product API and analytics WebSocket through same-origin paths (/api/*,
 * /ws), so no compile-time URL is baked in. Local development defaults to
 * the local services when VITE_API_URL / VITE_WS_API_URL are unset.
 */
export const API_BASE_URL: string =
  import.meta.env.VITE_API_URL?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:8787" : "");

export const WS_BASE_URL: string =
  import.meta.env.VITE_WS_API_URL?.replace(/\/+$/, "") ??
  (import.meta.env.DEV ? "http://localhost:8080" : "");
