import {
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { DatabaseTables } from "../../types/types";
import { users } from "./users";
import { teams } from "./teams";

export const teamMembers = pgTable(
  DatabaseTables.TEAM_MEMBERS,
  {
    id: uuid("id").defaultRandom().primaryKey(),
    user_id: uuid("user_id")
      .references(() => users.id, {
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
  },
  (table) => {
    return {
      teamMemberTeamIdIndex: uniqueIndex("team_member_team_id_index").on(
        table.team_id,
      ),
      teamMemberUserIdIndex: uniqueIndex("team_member_user_id_index").on(
        table.user_id,
      ),
    };
  },
);
