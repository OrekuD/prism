import { z } from 'zod';

export const RequestMagicLinkSignInRequestSchema = z.strictObject({
	email: z.string().email(),
});

type RequestMagicLinkSignInRequest = z.infer<typeof RequestMagicLinkSignInRequestSchema>;

export default RequestMagicLinkSignInRequest;
