import { InferSelectModel } from "drizzle-orm";
import { profiles } from "../database/schema/profiles";

export type Profile = InferSelectModel<typeof profiles> & {
  profile_picture_url: string | null | undefined;
};
