import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { users } from "./users";
import { teams } from "./teams";

export const projects = pgTable(
  DatabaseTables.PROJECTS,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creator_id: uuid("creator_id")
      .references(() => users.id)
      .notNull(),
    team_id: uuid("team_id")
      .references(() => teams.id, {
        onDelete: "cascade",
      })
      .notNull(),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
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
      projectSlugIndex: uniqueIndex("project_slug_index").on(table.slug),
    };
  },
);
