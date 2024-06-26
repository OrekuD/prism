import { Gender } from './../../types/types';
import { z } from 'zod';

export const UpdateUserRequestSchema = z.strictObject({
	userName: z.string().nullable(),
	firstName: z.string(),
	lastName: z.string(),
	gender: z.union([z.literal('male'), z.literal('female'), z.literal('other')]),
});

type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export default UpdateUserRequest;
