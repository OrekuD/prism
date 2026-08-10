import type { InferSelectModel } from "drizzle-orm";
import type { projectApiKeys } from "../database/schema/projectApiKeys";

export type ProjectApiKey = InferSelectModel<typeof projectApiKeys>;
