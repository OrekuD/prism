import { z } from 'zod';

export const RequestOTPSignInRequestSchema = z.strictObject({
	email: z.string().email(),
});

type RequestOTPSignInRequest = z.infer<typeof RequestOTPSignInRequestSchema>;

export default RequestOTPSignInRequest;
