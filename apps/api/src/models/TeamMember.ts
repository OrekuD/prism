import { InferSelectModel } from "drizzle-orm";
import { teamMembers } from "../database/schema/teamMembers";

type TeamMember = InferSelectModel<typeof teamMembers>;

export default TeamMember;
