import { InferSelectModel } from "drizzle-orm";
import { projects } from "../database/schema/projects";

export type Project = InferSelectModel<typeof projects> & {
  api_key: string | null;
};
