import type { InferSelectModel } from "drizzle-orm";
import type { profilePictures } from "../database/schema/profilePictures";

export type ProfilePicture = InferSelectModel<typeof profilePictures>;
