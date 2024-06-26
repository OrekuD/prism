import { InferSelectModel } from 'drizzle-orm';
import { profilePictures } from '../database/schema/profilePictures';

type ProfilePicture = InferSelectModel<typeof profilePictures>;

export default ProfilePicture;
