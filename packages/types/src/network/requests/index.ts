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
