import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { teams } from "./teams";
import { projects } from "./projects";

export const projectApiKeys = pgTable(
  DatabaseTables.PROJECT_API_KEYS,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    team_id: uuid("team_id")
      .references(() => teams.id, {
        onDelete: "cascade",
      })
      .notNull(),
    project_id: uuid("project_id").references(() => projects.id, {
      onDelete: "cascade",
    }),
    key: text("key").notNull(),
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
