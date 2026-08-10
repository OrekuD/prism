/**
 * Runtime adapter seam (task-6 section 2).
 *
 * The product API never imports provider-specific globals in business
 * logic: each runtime entry (Cloudflare Worker, Node server) registers the
 * adapters it provides, and the rest of the codebase consumes them through
 * this module.
 */

export type RuntimeAdapter = {
  /**
   * Product database driver. Returns a tagged-template query function
   * (neon-http on the Worker, postgres-js on Node) plus a drizzle instance
   * bound to the same connection for ORM-based access.
   */
  createProductDb: (env: Record<string, string | undefined>) => {
    /** Tagged-template SQL (the interface controllers use). */
    query: (strings: TemplateStringsArray, ...values: unknown[]) => Promise<Array<Record<string, unknown>>>;
    /** Drizzle instance for better-auth, provisioning, and migrations. */
    drizzle: unknown;
  };
};

let adapter: RuntimeAdapter | null = null;

export function setRuntimeAdapter(next: RuntimeAdapter): void {
  adapter = next;
}

export function getRuntimeAdapter(): RuntimeAdapter {
  if (!adapter) {
    throw new Error(
      "No runtime adapter registered. Import the Worker or Node entry point (src/index.ts / src/index.node.ts).",
    );
  }
  return adapter;
}
