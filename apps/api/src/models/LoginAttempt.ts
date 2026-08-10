import type { InferSelectModel } from "drizzle-orm";
import type { loginAttempts } from "../database/schema/loginAttempts";

export type LoginAttempt = InferSelectModel<typeof loginAttempts>;
