import { InferSelectModel } from "drizzle-orm";
import { teamInvites } from "../database/schema/teamInvites";

type TeamInvite = InferSelectModel<typeof teamInvites>;

export default TeamInvite;
