import type { InferSelectModel } from "drizzle-orm";
import type { teamMembers } from "../database/schema/teamMembers";

export type TeamMember = InferSelectModel<typeof teamMembers>;
