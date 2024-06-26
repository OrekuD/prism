import { z } from 'zod';

export const ForgotPasswordRequestSchema = z.strictObject({
	email: z.string().email(),
});

type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export default ForgotPasswordRequest;
