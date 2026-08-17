import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { projectSources } from "./projectSources";

/**
 * Task 13: an ingestion key belongs to exactly ONE source and, through it,
 * exactly one project. The row carries no project or organization id that
 * could disagree with the source relationship.
 *
 * - key_type: "publishable" (Web/iOS/Android/React Native — visible in
 *   client binaries, telemetry-write-only) or "secret" (Server API — never
 *   leaves the server).
 * - status: "active" | "revoked". Multiple active keys per source are
 *   allowed ONLY to support safe rotation.
 */
export const projectApiKeys = pgTable(
  DatabaseTables.PROJECT_API_KEYS,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    source_id: uuid("source_id")
      .references(() => projectSources.id, {
        onDelete: "cascade",
      })
      .notNull(),
    name: text("name").notNull(),
    key: text("key").notNull(),
    key_type: text("key_type").notNull(),
    status: text("status").notNull().default("active"),
    last_used_at: timestamp("last_used_at", {
      withTimezone: true,
      mode: "string",
      precision: 6,
    }),
    created_at: timestamp("created_at", {
      withTimezone: true,
      mode: "string",
      precision: 6,
    })
      .notNull()
      .defaultNow(),
    updated_at: timestamp("updated_at", {
      withTimezone: true,
      mode: "string",
      precision: 6,
    })
      .notNull()
      .defaultNow(),
  },
  (table) => {
    return {
      keyIndex: uniqueIndex("key_index").on(table.key),
    };
  },
);
