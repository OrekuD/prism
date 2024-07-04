import { InferSelectModel } from "drizzle-orm";
import { teamInvites } from "../database/schema/teamInvites";

export type TeamInvite = InferSelectModel<typeof teamInvites>;
