import type { InferSelectModel } from "drizzle-orm";
import type { teamInvites } from "../database/schema/teamInvites";

export type TeamInvite = InferSelectModel<typeof teamInvites>;
