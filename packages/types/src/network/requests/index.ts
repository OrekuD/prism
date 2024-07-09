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

export const UpdateUserInformationRequestSchema = z.strictObject({
  firstName: z.string(),
  lastName: z.string(),
});

export type UpdateUserInformationRequest = z.infer<
  typeof UpdateUserInformationRequestSchema
>;

export const UpdateUsernameRequestSchema = z.strictObject({
  userName: z.string(),
});

export type UpdateUsernameRequest = z.infer<typeof UpdateUsernameRequestSchema>;

export const VerifyEmailRequestSchema = z.strictObject({
  token: z.string(),
});

export type VerifyEmailRequest = z.infer<typeof VerifyEmailRequestSchema>;

export const SendTeamInvitesRequestSchema = z.strictObject({
  emails: z.array(z.string()),
  teamId: z.string(),
});

export type SendTeamInvitesRequest = z.infer<
  typeof SendTeamInvitesRequestSchema
>;

export const DeleteTeamRequestSchema = z.strictObject({
  teamId: z.string(),
});

export type DeleteTeamRequest = z.infer<typeof DeleteTeamRequestSchema>;

export const DeleteProjectRequestSchema = z.strictObject({
  projectId: z.string(),
  slug: z.string(),
  teamId: z.string(),
});

export type DeleteProjectRequest = z.infer<typeof DeleteProjectRequestSchema>;

export const JoinTeamRequestSchema = z.strictObject({
  teamId: z.string(),
});

export type JoinTeamRequest = z.infer<typeof JoinTeamRequestSchema>;

export const LeaveTeamRequestSchema = z.strictObject({
  teamId: z.string(),
});

export type LeaveTeamRequest = z.infer<typeof LeaveTeamRequestSchema>;

export const CreateProjectRequestSchema = z.strictObject({
  teamId: z.string(),
  name: z.string(),
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

export const AddNewSessionDataRequestSchema = z.strictObject({
  referrer: z.string(),
  userAgent: z.string(),
  countryCode: z.string(),
  location: z.string(),
});

export type AddNewSessionDataRequest = z.infer<
  typeof AddNewSessionDataRequestSchema
>;

export const ProjectDetailedRequestSchema = z.strictObject({
  slug: z.string().optional(),
  duration: z
    .union([
      z.literal("24-hours"),
      z.literal("seven-days"),
      z.literal("two-weeks"),
      z.literal("one-month"),
      z.literal("three-months"),
      z.literal("one-year"),
    ])
    .nullable(),
});

export type ProjectDetailedRequest = z.infer<
  typeof ProjectDetailedRequestSchema
>;
