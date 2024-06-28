import { z } from 'zod';

export const VerifyEmailRequestSchema = z.strictObject({
	token: z.string(),
});

type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export default VerifyEmailRequest;
