import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { teams } from "./teams";
import { users } from "./users";

export const teamInvites = pgTable(DatabaseTables.TEAM_INVITES, {
  id: uuid("id").defaultRandom().primaryKey(),
  team_id: uuid("team_id")
    .references(() => teams.id, {
      onDelete: "cascade",
    })
    .notNull(),
  email: text("email").notNull(),
  user_id: uuid("user_id").references(() => users.id),
  status: text("status").notNull(),
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
