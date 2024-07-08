import { InferSelectModel } from "drizzle-orm";
import { projectApiKeys } from "../database/schema/projectApiKeys";

export type ProjectApiKey = InferSelectModel<typeof projectApiKeys>;
