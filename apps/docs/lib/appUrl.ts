/**
 * Central webapp URL for the docs site.
 *
 * - Local dev (portless): https://prism.localhost
 * - Local vite fallback: http://localhost:5173
 * - Production: set NEXT_PUBLIC_APP_URL to your webapp origin
 *   e.g. https://prism.cloud or https://your-app.vercel.app
 */
export const APP_URL =
  process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") ?? "http://localhost:5173";
