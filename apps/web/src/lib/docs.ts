/**
 * Central docs site URL for the webapp.
 *
 * - Local dev (portless): https://docs.prism.localhost
 * - Production: set VITE_DOCS_URL to your docs origin
 *   e.g. https://docs.prism.cloud or https://your-docs.vercel.app
 */
export const DOCS_URL =
  import.meta.env.VITE_DOCS_URL?.replace(/\/+$/, "") ?? "http://localhost:3000";
