import { InferSelectModel } from 'drizzle-orm';
import { oAuthAccessTokens } from '../database/schema/oAuthAccessTokens';

type OAuthAccessToken = InferSelectModel<typeof oAuthAccessTokens>;

export default OAuthAccessToken;
