import { z } from 'zod';

export const MagicLinkSignInRequestSchema = z.strictObject({
	token: z.string(),
});

type MagicLinkSignInRequest = z.infer<typeof MagicLinkSignInRequestSchema>;

export default MagicLinkSignInRequest;
