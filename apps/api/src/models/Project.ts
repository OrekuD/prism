import type { InferSelectModel } from "drizzle-orm";
import type { projects } from "../database/schema/projects";

export type Project = InferSelectModel<typeof projects> & {
  api_key: string | null;
};
