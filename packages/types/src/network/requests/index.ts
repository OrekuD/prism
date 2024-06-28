import { z } from "zod";

export const ChangeEmailRequestSchema = z.strictObject({
  email: z.string().email(),
});

export type ChangeEmailRequest = z.infer<typeof ChangeEmailRequestSchema>;

export const ChangePasswordRequestSchema = z.strictObject({
  oldPassword: z.string(),
  newPassword: z.string(),
});

export type ChangePasswordRequest = z.infer<typeof ChangePasswordRequestSchema>;

export const CreateTeamRequestSchema = z.strictObject({
  name: z.string(),
});

export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const ForgotPasswordRequestSchema = z.strictObject({
  email: z.string().email(),
});

export type ForgotPasswordRequest = z.infer<typeof ForgotPasswordRequestSchema>;

export const MagicLinkSignInRequestSchema = z.strictObject({
  token: z.string(),
});

export type MagicLinkSignInRequest = z.infer<
  typeof MagicLinkSignInRequestSchema
>;

export const OTPSignInRequestSchema = z.strictObject({
  otp: z.number(),
});

export type OTPSignInRequest = z.infer<typeof OTPSignInRequestSchema>;

export const RequestMagicLinkSignInRequestSchema = z.strictObject({
  email: z.string().email(),
});

export type RequestMagicLinkSignInRequest = z.infer<
  typeof RequestMagicLinkSignInRequestSchema
>;

export const RequestOTPSignInRequestSchema = z.strictObject({
  email: z.string().email(),
});

export type RequestOTPSignInRequest = z.infer<
  typeof RequestOTPSignInRequestSchema
>;

export const ResetPasswordRequestSchema = z.strictObject({
  resetPasswordToken: z.string(),
  password: z.string(),
});

export type ResetPasswordRequest = z.infer<typeof ResetPasswordRequestSchema>;

export const SignInRequestSchema = z.strictObject({
  email: z.string().email(),
  password: z.string(),
});

export type SignInRequest = z.infer<typeof SignInRequestSchema>;

export const SignUpRequestSchema = z.strictObject({
  email: z.string().email(),
  firstname: z.string(),
  lastname: z.string(),
  password: z.string(),
});

export type SignUpRequest = z.infer<typeof SignUpRequestSchema>;

const maxFileSize = 5000000;
const acceptedImages = [
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heif",
  "image/heic",
];

export const UpdateProfilePictureRequestSchema = z.strictObject({
  file: z
    .any()
    .refine((file) => file?.size <= maxFileSize, `Max image size is 5MB.`)
    .refine(
      (file) => acceptedImages.includes(file?.type),
      "File type not supported",
    ),
});

export type UpdateProfilePictureRequest = z.infer<
  typeof UpdateProfilePictureRequestSchema
>;

export const UpdateUserRequestSchema = z.strictObject({
  userName: z.string().nullable(),
  firstName: z.string(),
  lastName: z.string(),
  gender: z.union([z.literal("male"), z.literal("female"), z.literal("other")]),
});

export type UpdateUserRequest = z.infer<typeof UpdateUserRequestSchema>;

export const VerifyEmailRequestSchema = z.strictObject({
  token: z.string(),
});

export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;
