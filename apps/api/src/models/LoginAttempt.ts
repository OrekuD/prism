import { InferSelectModel } from "drizzle-orm";
import { loginAttempts } from "../database/schema/loginAttempts";

export type LoginAttempt = InferSelectModel<typeof loginAttempts>;
