import { z } from 'zod';

export const OTPSignInRequestSchema = z.strictObject({
	otp: z.number(),
});

type OTPSignInRequest = z.infer<typeof OTPSignInRequestSchema>;

export default OTPSignInRequest;
