import {
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { user } from "./auth";
import { organization } from "./auth";

export const projects = pgTable(
  DatabaseTables.PROJECTS,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    creator_id: text("creator_id")
      .references(() => user.id)
      .notNull(),
    // Task 13: the tenant is a Better Auth organization (workspace).
    organization_id: text("organization_id")
      .references(() => organization.id, {
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
