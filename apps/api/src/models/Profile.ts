import type { InferSelectModel } from "drizzle-orm";
import type { profiles } from "../database/schema/profiles";

export type Profile = InferSelectModel<typeof profiles> & {
  profile_picture_url: string | null | undefined;
};
