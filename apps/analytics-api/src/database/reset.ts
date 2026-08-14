/**
 * Guarded analytics-store reset (task-9 §9, slice 5).
 *
 * Deletes ALL analytics tables (v2 + legacy) and the migration journal so
 * a DISPOSABLE development/test store can be rebuilt from scratch with
 * `db:migrate`. It is intentionally hostile to accidents:
 *
 *   1. Prints the resolved NON-SECRET target identity (host or file path;
 *      never the auth token).
 *   2. Refuses targets that are not explicitly approved: file: URLs and
 *      loopback-only hosts (localhost / 127.0.0.1 / ::1). Hosted Turso
 *      URLs and internal compose hosts are refused.
 *   3. Requires BOTH `ANALYTICS_RESET_ALLOW=1` and an explicit `--yes`
 *      confirmation flag.
 *
 * Usage:
 *   ANALYTICS_RESET_ALLOW=1 yarn workspace prism-analytics-api db:reset --yes
 */
import { createClient, type Client } from "@libsql/client";
import { config } from "dotenv";
import { logger } from "../utils/logger.js";

config();

/** Resolved non-secret target identity for logging/confirmation. */
export function targetIdentity(url: string): string {
  if (url.startsWith("file:")) {
    return url;
  }
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}:${parsed.port || "default"}`;
  } catch {
    return "(unparsable URL)";
  }
}

/**
 * Approval policy: file: URLs and loopback-only hosts are approved by
 * default. Anything else (hosted Turso, internal service names, public
 * hosts) is refused UNLESS the operator pins the exact target with
 * ANALYTICS_RESET_TARGET — a full exact match against the configured
 * TURSO_DATABASE_URL — which is the explicit, declared escape hatch for
 * a DISPOSABLE hosted dev database. An unpinned hosted store is always
 * refused.
 */
export function isApprovedResetTarget(url: string): boolean {
  if (url.startsWith("file:")) return true;
  let hostname = "";
  try {
    // URL.hostname keeps IPv6 brackets: "[::1]"
    hostname = new URL(url).hostname.replace(/^\[|\]$/g, "");
  } catch {
    return false;
  }
  if (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1") {
    return true;
  }
  const pinned = process.env.ANALYTICS_RESET_TARGET ?? "";
  return pinned.length > 0 && pinned === url;
}

// `events` covers BOTH the legacy v1 table and the v2 model (same table
// name — the migration replaces the shape); sessions_v2 is the v2 model;
// `sessions` is the legacy v1 table.
const DROP_STATEMENTS = [
  "DROP TABLE IF EXISTS events",
  "DROP TABLE IF EXISTS sessions_v2",
  "DROP TABLE IF EXISTS events_v2",
  "DROP TABLE IF EXISTS sessions",
  "DROP TABLE IF EXISTS people",
  "DROP TABLE IF EXISTS external_identities",
  "DROP TABLE IF EXISTS anonymous_identities",
  "DROP TABLE IF EXISTS person_traits",
  "DROP TABLE IF EXISTS identity_ops",
  "DROP TABLE IF EXISTS schema_migrations",
];

/** Drop every analytics table + the journal in one atomic write batch. */
export async function resetStore(client: Client): Promise<void> {
  await client.batch(
    DROP_STATEMENTS.map((sql) => ({ sql })),
    "write",
  );
}

export function main(): void {
  const args = process.argv.slice(2);
  const confirmed = args.includes("--yes");
  const url = process.env.TURSO_DATABASE_URL ?? "";

  logger.info("analytics:reset", "resolved target", { target: targetIdentity(url) });

  if (!url) {
    logger.error("analytics:reset", "TURSO_DATABASE_URL is required");
    process.exit(1);
  }
  if (!isApprovedResetTarget(url)) {
    logger.error(
      "analytics:reset",
      `refused: ${targetIdentity(url)} is not an approved disposable target (file:/loopback, or pin the EXACT url with ANALYTICS_RESET_TARGET for a declared disposable hosted dev store)`,
    );
    process.exit(1);
  }
  if (process.env.ANALYTICS_RESET_ALLOW !== "1") {
    logger.error(
      "analytics:reset",
      "refused: set ANALYTICS_RESET_ALLOW=1 to confirm this is a disposable development/test store",
    );
    process.exit(1);
  }
  if (!confirmed) {
    logger.error(
      "analytics:reset",
      "refused: pass --yes to confirm the destructive reset",
    );
    process.exit(1);
  }

  const client = createClient({
    url,
    authToken: process.env.TURSO_AUTH_TOKEN ?? "",
  });
  resetStore(client)
    .then(() => {
      logger.info(
        "analytics:reset",
        "analytics tables dropped — run `yarn workspace prism-analytics-api db:migrate` to rebuild",
      );
    })
    .catch((error) => {
      logger.error("analytics:reset", "reset failed", {
        message: error instanceof Error ? error.message : error,
      });
      process.exit(1);
    })
    .finally(() => client.close());
}

// Only run the CLI when executed directly (not when imported by tests).
const isMain =
  (process.argv[1] ?? "").endsWith("reset.ts") ||
  (process.argv[1] ?? "").endsWith("reset.js");
if (isMain) {
  main();
}
