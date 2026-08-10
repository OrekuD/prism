import type { InferSelectModel } from "drizzle-orm";
import type { Profile } from "./Profile";
import type { users } from "../database/schema/users";

export type User = InferSelectModel<typeof users> & {
  profile: Profile | null;
};
