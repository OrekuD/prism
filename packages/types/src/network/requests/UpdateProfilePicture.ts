import { z } from 'zod';

const maxFileSize = 5000000;
const acceptedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/heif', 'image/heic'];

export const UpdateProfilePictureRequestSchema = z.strictObject({
	file: z
		.any()
		.refine((file) => file?.size <= maxFileSize, `Max image size is 5MB.`)
		.refine((file) => acceptedImages.includes(file?.type), 'File type not supported'),
});

type UpdateProfilePictureRequest = z.infer<typeof UpdateProfilePictureRequestSchema>;

export default UpdateProfilePictureRequest;
