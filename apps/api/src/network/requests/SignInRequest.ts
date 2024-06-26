import { z } from 'zod';

export const SignInRequestSchema = z.strictObject({
	email: z.string().email(),
	password: z.string(),
});

type SignInRequest = z.infer<typeof SignInRequestSchema>;

export default SignInRequest;
