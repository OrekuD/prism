import { z } from 'zod';

export const SignUpRequestSchema = z.strictObject({
	email: z.string().email(),
	firstname: z.string(),
	lastname: z.string(),
	password: z.string(),
});

type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

export default SignUpRequest;
