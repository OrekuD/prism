import type { InferSelectModel } from "drizzle-orm";
import type { Profile } from "./Profile";
import type { user } from "../database/schema/auth";

/**
 * The Prism user: Better Auth identity plus product profile.
 * Attached to Hono context by AuthenticationMiddleware.
 */
export type PrismUser = InferSelectModel<typeof user> & {
  profile: Profile | null;
};

export type { user as UserTable };
