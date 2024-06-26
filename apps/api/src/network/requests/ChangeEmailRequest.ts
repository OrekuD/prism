import { z } from 'zod';

export const ChangeEmailRequestSchema = z.strictObject({
	email: z.string().email(),
});

type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

export default ChangeEmailRequest;
