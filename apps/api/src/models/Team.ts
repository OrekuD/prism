import { InferSelectModel } from "drizzle-orm";
import { teams } from "../database/schema/teams";

type Team = InferSelectModel<typeof teams>;

export default Team;
