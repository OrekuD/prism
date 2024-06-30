import { InferSelectModel } from "drizzle-orm";
import { profiles } from "../database/schema/profiles";

type Profile = InferSelectModel<typeof profiles> & {
  profile_picture_url: string | null | undefined;
};

export default Profile;
