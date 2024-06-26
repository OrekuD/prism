import { z } from 'zod';

export const ResetPasswordRequestSchema = z.strictObject({
	resetPasswordToken: z.string(),
	password: z.string(),
});

type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export default ResetPasswordRequest;
