import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { users } from "./users";

export const teams = pgTable(DatabaseTables.TEAMS, {
  id: uuid("id").defaultRandom().primaryKey(),
  owner_id: uuid("owner_id")
    .references(() => users.id, {
      onDelete: "cascade",
    })
    .notNull(),
  name: text("name").notNull(),
  logo_asset_id: text("logo_asset_id"),
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
});
