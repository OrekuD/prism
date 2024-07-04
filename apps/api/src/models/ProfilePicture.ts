import { InferSelectModel } from "drizzle-orm";
import { profilePictures } from "../database/schema/profilePictures";

export type ProfilePicture = InferSelectModel<typeof profilePictures>;
