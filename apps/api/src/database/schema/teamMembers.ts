import {
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { user } from "./auth";
import { teams } from "./teams";

export const teamMembers = pgTable(DatabaseTables.TEAM_MEMBERS, {
  id: uuid("id").defaultRandom().primaryKey(),
  user_id: text("user_id")
    .references(() => user.id, {
      onDelete: "cascade",
    })
    .notNull(),
  team_id: uuid("team_id")
    .references(() => teams.id, {
      onDelete: "cascade",
    })
    .notNull(),
  permission_id: integer("permission_id").notNull(),
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
