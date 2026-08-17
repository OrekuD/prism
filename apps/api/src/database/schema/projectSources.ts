import {
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { projects } from "./projects";

/**
 * Task 13: a project source is one installation that sends telemetry to a
 * project (web app, iOS, Android, React Native, server API). It is the
 * data producer and SDK-configuration boundary, not a user or permission
 * boundary. Its platform selects the install instructions and key
 * visibility; web sources carry an explicit allowed-origin policy.
 */
export const projectSources = pgTable(DatabaseTables.PROJECT_SOURCES, {
  id: uuid("id").defaultRandom().primaryKey(),
  project_id: uuid("project_id")
    .references(() => projects.id, {
      onDelete: "cascade",
    })
    .notNull(),
  name: text("name").notNull(),
  // Supported platforms are constrained server-side to the fixed set
  // (web | ios | android | react-native | server) — callers never choose
  // arbitrary capabilities.
  platform: text("platform").notNull(),
  // JSON array of allowed origins for publishable WEB sources; empty for
  // every other platform. Enforced on ingest for publishable keys.
  allowed_origins: text("allowed_origins").notNull().default("[]"),
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
