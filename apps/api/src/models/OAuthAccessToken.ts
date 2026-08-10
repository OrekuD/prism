import type { InferSelectModel } from "drizzle-orm";
import type { oAuthAccessTokens } from "../database/schema/oAuthAccessTokens";

export type OAuthAccessToken = InferSelectModel<typeof oAuthAccessTokens>;
