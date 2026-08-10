import type { Context } from "hono";
import type { HonoConfig } from "../types/types";
import {
  type ChangeEmailRequest,
  ChangeEmailRequestSchema,
  type ChangePasswordRequest,
  ChangePasswordRequestSchema,
  type UpdateUserInformationRequest,
  UpdateUserInformationRequestSchema,
  type UpdateUsernameRequest,
  UpdateUsernameRequestSchema,
} from "@prism/types";
import { validateData } from "../utils/validateData";
import { DatabaseManager } from "../managers/DatabaseManager";
import type { User } from "../models/User";
import bcrypt from "bcryptjs";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { validateImageFile } from "../utils/validateImageFile";
import { OkResponse } from "../network/responses/OkResponse";
import type { Profile } from "../models/Profile";
import { UserResponse } from "../network/responses/UserResponse";
import { AuthController } from "./AuthController";
import { MailManager } from "../managers/MailManager";
import { UploadController } from "./UploadController";
import type { ProfilePicture } from "../models/ProfilePicture";
import { ProfilePictureResponse } from "../network/responses/ProfilePictureResponse";
import { ProfileResponse } from "../network/responses/ProfileResponse";
import { ChangeEmailResponse } from "../network/responses/ChangeEmailResponse";
import { UpdateUsernameResponse } from "../network/responses/UpdateUsernameResponse";

export class UserController {
  public static async currentUser(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    return ctx.json(new UserResponse(user).toJSON());
  }

  public static async changePassword(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<ChangePasswordRequest>();

    const data = validateData(ChangePasswordRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    if (!bcrypt.compareSync(data.oldPassword, user.password)) {
      return ctx.json(
        new ErrorResponse("old_password_incorrect").toJSON(),
        400,
      );
    }

    const hashedPassword = bcrypt.hashSync(
      data.newPassword,
      bcrypt.genSaltSync(),
    );

    const db = DatabaseManager.getInstance(ctx);

    const rows =
      await db`UPDATE users SET password = ${hashedPassword} WHERE id = ${user.id} RETURNING id`;

    if (rows.length === 0) {
      return ctx.json(new ErrorResponse("database_error").toJSON(), 400);
    }

    await db`DELETE FROM oauth_access_tokens WHERE user_id = ${user.id}`;

    return AuthController._authenticate(ctx, user);
  }

  public static async changeEmail(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<ChangeEmailRequest>();

    const data = validateData(ChangeEmailRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);

    const emailTaken =
      await db`SELECT id FROM users WHERE email = ${data.email.trim().toLowerCase()} AND NOT id = ${user.id}`;

    if (emailTaken.length > 0) {
      return ctx.json(new ErrorResponse("email_taken").toJSON(), 400);
    }

    if (user.profile?.email_verified_at === null) {
      // const confirmEmailLink = await AuthController._generateVerifyEmailURL(ctx, userObject!.id);
      // await MailManager.dispatch(
      // 	ctx,
      // 	{
      // 		name: 'confirm-email',
      // 		props: {
      // 			name: userObject?.profile?.first_name || userObject!.email,
      // 			confirmEmailLink,
      // 		},
      // 	},
      // 	userObject!.email
      // );

      return ctx.json(new ErrorResponse("email_not_verified").toJSON(), 400);
    }

    await db`UPDATE users SET email = ${data.email.trim().toLowerCase()} WHERE id = ${user.id}`;
    await db`UPDATE profiles SET email_verified_at = NULL WHERE id = ${user.id}`;

    const confirmEmailLink = await AuthController._generateVerifyEmailURL(
      ctx,
      user.id,
    );
    await MailManager.dispatch(
      ctx,
      {
        name: "new-email",
        props: {
          name: user.profile?.first_name || user.email,
          confirmEmailLink,
        },
      },
      user.email,
    );

    return ctx.json(new ChangeEmailResponse(data.email.trim()).toJSON());
  }

  public static async sendVerifyEmail(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }
    const confirmEmailLink = await AuthController._generateVerifyEmailURL(
      ctx,
      user.id,
    );

    await MailManager.dispatch(
      ctx,
      {
        name: "confirm-email",
        props: {
          name: user?.profile?.first_name || user?.email,
          confirmEmailLink,
        },
      },
      user.email,
    );

    return ctx.json(new OkResponse().toJSON());
  }

  public static async updateProfilePicture(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const body = await ctx.req.parseBody();

    const file: File | undefined = body.file as File;

    if (!file) {
      return ctx.json(new ErrorResponse("file_not_found").toJSON(), 400);
    }

    const validationErrors = await validateImageFile(file);

    if (validationErrors.length > 0) {
      return ctx.json(new ErrorResponse(validationErrors).toJSON(), 400);
    }

    const uploadResult = await UploadController.uploadSingle(
      ctx,
      file,
      "/users/profile-pictures",
      `${file.name}`,
    );

    if (!uploadResult) {
      return ctx.json(new ErrorResponse("file_not_uploaded").toJSON(), 400);
    }

    const db = DatabaseManager.getInstance(ctx);

    const profilePicture =
      (await db`SELECT profile_picture_id, user_id FROM profile_pictures WHERE user_id = ${user.id}`) as Array<ProfilePicture>;

    if (profilePicture.length > 0) {
      await UploadController.deleteFile(
        ctx,
        profilePicture[0].profile_picture_id,
      );
      await db`DELETE FROM profile_pictures WHERE user_id = ${profilePicture[0].user_id}`;
    }

    await db`INSERT INTO profile_pictures (user_id, profile_picture_url, profile_picture_id) VALUES (${user.id}, ${uploadResult.url}, ${uploadResult.fileId})`;

    return ctx.json(new ProfilePictureResponse(uploadResult.url).toJSON());
  }

  public static async updateUserInformation(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<UpdateUserInformationRequest>();

    const data = validateData(UpdateUserInformationRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const db = DatabaseManager.getInstance(ctx);

    const updatedProfile =
      (await db`UPDATE profiles SET first_name = ${data.firstName}, last_name = ${data.lastName} WHERE user_id = ${user.id} RETURNING *`) as Array<Profile>;

    if (updatedProfile.length === 0) {
      return ctx.json(new ErrorResponse("profile_not_updated").toJSON(), 400);
    }

    return ctx.json(new ProfileResponse(updatedProfile[0]).toJSON());
  }

  public static async updateUsername(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<UpdateUsernameRequest>();

    const data = validateData(UpdateUsernameRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    if (user.user_name?.toLowerCase() === data.userName.toLowerCase()) {
      return ctx.json(new UserResponse(user).toJSON());
    }

    const db = DatabaseManager.getInstance(ctx);

    const usernameTaken =
      await db`SELECT id FROM users WHERE LOWER(user_name) = LOWER(${data.userName}) AND NOT id = ${user.id}`;

    if (usernameTaken.length > 0) {
      return ctx.json(new ErrorResponse("username_taken").toJSON(), 400);
    }

    const updatedUser =
      (await db`UPDATE users SET user_name = ${data.userName} WHERE id = ${user.id} RETURNING *`) as Array<User>;

    if (updatedUser.length === 0) {
      return ctx.json(new ErrorResponse("profile_not_updated").toJSON(), 400);
    }

    return ctx.json(new UpdateUsernameResponse(data.userName).toJSON());
  }
}
