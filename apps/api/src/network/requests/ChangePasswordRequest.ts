import { z } from 'zod';

export const ChangePasswordRequestSchema = z.strictObject({
	oldPassword: z.string(),
	newPassword: z.string(),
});

type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export default ChangePasswordRequest;
