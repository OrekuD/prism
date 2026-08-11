import { bigint, check, integer, pgTable } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * One-time first-owner setup claim (single row, id = 1).
 *
 * The first-boot endpoint inserts this row to make owner creation atomic
 * across concurrent requests: only one INSERT can win the PRIMARY KEY,
 * the rest get a constraint error. `claimed_at` lets a crashed request
 * be detected — a claim older than the TTL with zero users is stale and
 * is removed before retrying.
 */
export const setupClaim = pgTable(
  "setup_claim",
  {
    id: integer("id").primaryKey(),
    /** Epoch milliseconds when the claim was taken. */
    claimedAt: bigint("claimed_at", { mode: "number" }).notNull(),
  },
  (table) => [
    check("setup_claim_id_is_one", sql`${table.id} = 1`),
  ],
);
