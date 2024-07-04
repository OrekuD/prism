import { InferSelectModel } from "drizzle-orm";
import { teams } from "../database/schema/teams";

export type Team = InferSelectModel<typeof teams> & {
  avatar_url: string;
};
