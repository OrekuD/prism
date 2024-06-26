import { InferSelectModel } from 'drizzle-orm';
import { profiles } from '../database/schema/profiles';

type Profile = InferSelectModel<typeof profiles>;

export default Profile;
