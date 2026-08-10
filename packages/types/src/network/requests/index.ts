import { z } from "zod";

export const CreateTeamRequestSchema = z.strictObject({
  name: z.string(),
});

export type CreateTeamRequest = z.infer<typeof CreateTeamRequestSchema>;

export const MagicLinkSignInRequestSchema = z.strictObject({
  token: z.string(),
});

export type MagicLinkSignInRequest = z.infer<
  typeof MagicLinkSignInRequestSchema
>;

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

export const StartSessionRequestSchema = z.strictObject({
  referrer: z.string(),
  userAgent: z.string(),
  location: z.string(),
});

export type StartSessionRequest = z.infer<typeof StartSessionRequestSchema>;

export const EndSessionRequestSchema = z.strictObject({
  sessionId: z.string(),
});

export type EndSessionRequest = z.infer<typeof EndSessionRequestSchema>;

export const LogEventRequestSchema = z.strictObject({
  sessionId: z.string().min(1),
  name: z.string().min(1).max(128),
  data: z.record(z.string(), z.unknown()).optional(),
});

export type LogEventRequest = z.infer<typeof LogEventRequestSchema>;

export const RenameProjectRequestSchema = z.strictObject({
  name: z.string().min(1).max(120),
});

export type RenameProjectRequest = z.infer<typeof RenameProjectRequestSchema>;

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
