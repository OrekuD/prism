import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { teams } from "./teams";

export const teamAvatars = pgTable(DatabaseTables.TEAM_AVATARS, {
  id: uuid("id").defaultRandom().primaryKey(),
  team_id: uuid("team_id")
    .references(() => teams.id, {
      onDelete: "cascade",
    })
    .notNull(),
  image_asset_url: text("image_asset_url").notNull(),
  image_asset_id: text("image_asset_id").notNull(),
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
