import { InferSelectModel } from "drizzle-orm";
import { Profile } from "./Profile";
import { users } from "../database/schema/users";

export type User = InferSelectModel<typeof users> & {
  profile: Profile | null;
};
