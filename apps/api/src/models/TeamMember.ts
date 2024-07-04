import { InferSelectModel } from "drizzle-orm";
import { teamMembers } from "../database/schema/teamMembers";

export type TeamMember = InferSelectModel<typeof teamMembers>;
