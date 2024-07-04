import { InferSelectModel } from "drizzle-orm";
import { oAuthAccessTokens } from "../database/schema/oAuthAccessTokens";

export type OAuthAccessToken = InferSelectModel<typeof oAuthAccessTokens>;
