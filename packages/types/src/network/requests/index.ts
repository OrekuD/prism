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
      (file) => acceptedImages.indexOf(file?.type) !== -1,
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

// Task 13: a project is created inside a Better Auth organization
// (workspace). The id is only a target — membership is proven server-side
// on the canonical member table, never taken from the client.
export const CreateProjectRequestSchema = z.strictObject({
  organizationId: z.string(),
  name: z.string(),
});

export type CreateProjectRequest = z.infer<typeof CreateProjectRequestSchema>;

// The v1 analytics ingestion requests (StartSession/EndSession/LogEvent)
// were removed with the v1 routes (task-9 slice 6) — the v2 SDK sends the
// versioned batch envelope to POST /api/v2/ingest.
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
