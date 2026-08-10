import type { InferSelectModel } from "drizzle-orm";
import type { teams } from "../database/schema/teams";

export type Team = InferSelectModel<typeof teams> & {
  avatar_url: string;
};
