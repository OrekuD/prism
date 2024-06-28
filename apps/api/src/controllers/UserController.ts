import { Context } from "hono";
import { HonoConfig } from "../types/types";
import {
  Roles,
  ChangeEmailRequest,
  ChangeEmailRequestSchema,
  ChangePasswordRequest,
  ChangePasswordRequestSchema,
  UpdateUserRequest,
  UpdateUserRequestSchema,
} from "@prism/types";
import validateData from "../utils/validateData";
import DatabaseManager from "../managers/DatabaseManager";
import User from "../models/User";
import bcrypt from "bcryptjs";
import ErrorResponse from "../network/responses/ErrorResponse";
import OkResponse from "../network/responses/OkResponse";
import Profile from "../models/Profile";
import UserResponse from "../network/responses/UserResponse";
import AuthController from "./AuthController";
import MailManager from "../managers/MailManager";
import UploadController from "./UploadController";
import ProfilePicture from "../models/ProfilePicture";
import ProfilePictureResponse from "../network/responses/ProfilePictureResponse";

export default class UserController {
  public static async currentUser(ctx: Context<HonoConfig>) {
    console.log("here");
    return ctx.json(new UserResponse(ctx.get("user")!).toJSON());
  }

  public static async changePassword(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<ChangePasswordRequest>();

    const data = validateData(ChangePasswordRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");

    if (!bcrypt.compareSync(data.oldPassword, user!.password)) {
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
      await db`UPDATE users SET password = ${hashedPassword} WHERE id = ${user!.id} RETURNING id`;

    if (rows.length === 0) {
      return ctx.json(new ErrorResponse("database_error").toJSON(), 400);
    }

    await db`DELETE FROM oauth_access_tokens WHERE user_id = ${user!.id}`;

    return AuthController._authenticate(ctx, user!);
  }

  public static async changeEmail(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<ChangeEmailRequest>();

    const data = validateData(ChangeEmailRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const userObject = ctx.get("user");

    const db = DatabaseManager.getInstance(ctx);

    const profile =
      (await db`SELECT email_verified_at FROM profiles WHERE user_id = ${userObject!.id}`) as Array<Profile>;

    if (profile.length === 0) {
      return ctx.json(new ErrorResponse("profile_not_found").toJSON(), 404);
    }

    if (profile[0].email_verified_at === null) {
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

    await db`UPDATE users SET email = ${data.email.trim().toLowerCase()} WHERE id = ${userObject!.id}`;
    await db`UPDATE profiles SET email_verified_at = NULL WHERE id = ${userObject!.id}`;

    const confirmEmailLink = await AuthController._generateVerifyEmailURL(
      ctx,
      userObject!.id,
    );
    await MailManager.dispatch(
      ctx,
      {
        name: "new-email",
        props: {
          name: userObject?.profile?.first_name || userObject!.email,
          confirmEmailLink,
        },
      },
      userObject!.email,
    );

    return ctx.json(new OkResponse().toJSON());
  }

  public static async sendVerifyEmail(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    const confirmEmailLink = await AuthController._generateVerifyEmailURL(
      ctx,
      user!.id,
    );

    await MailManager.dispatch(
      ctx,
      {
        name: "confirm-email",
        props: {
          name: user?.profile?.first_name || user!.email,
          confirmEmailLink,
        },
      },
      user!.email,
    );

    return ctx.json(new OkResponse().toJSON());
  }

  public static async updateProfilePicture(ctx: Context<HonoConfig>) {
    const user = ctx.get("user")!;

    const body = await ctx.req.parseBody();

    const file = body["file"] as File;

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
      (await db`SELECT profile_picture_id FROM profile_pictures WHERE user_id = ${user.id}`) as Array<ProfilePicture>;

    if (profilePicture.length > 0) {
      await UploadController.deleteFile(
        ctx,
        profilePicture[0].profile_picture_id,
      );
      db`DELETE FROM profile_pictures WHERE user_id = ${profilePicture[0].user_id}`;
    }

    db`INSERT INTO profile_pictures (user_id, profile_picture_url, profile_picture_id) VALUES (${user.id}, ${uploadResult.url}, ${uploadResult.fileId})`;

    return ctx.json(new ProfilePictureResponse(uploadResult.url).toJSON());
  }

  public static async updateUser(ctx: Context<HonoConfig>) {
    const body = await ctx.req.json<UpdateUserRequest>();

    const data = validateData(UpdateUserRequestSchema, body);

    if (Array.isArray(data)) {
      return ctx.json(new ErrorResponse(data).toJSON(), 400);
    }

    const user = ctx.get("user");

    const db = DatabaseManager.getInstance(ctx);

    await db`BEGIN`;

    let updatedUser =
      (await db`UPDATE users SET user_name = ${data.userName} WHERE id = ${user!.id} RETURNING id`) as Array<User>;

    const updatedProfile =
      await db`UPDATE profiles SET first_name = ${data.firstName}, last_name = ${data.lastName}, gender = ${
        data.gender
      } WHERE user_id = ${user!.id} RETURNING id`;

    if (updatedUser.length === 0 || updatedProfile.length === 0) {
      await db`ROLLBACK`;

      return ctx.json(new ErrorResponse("user_not_updated").toJSON(), 400);
    }

    updatedUser = (await db`
			SELECT
				users.id as id,
				users.email as email,
				users.user_name as user_name,
				users.password as password,
				json_build_object(
					'first_name', profiles.first_name,
					'last_name', profiles.last_name,
					'gender', profiles.gender,
					'email_verified_at', profiles.email_verified_at
				) AS profile
			FROM
				users
			JOIN
				profiles ON users.id = profiles.user_id
			WHERE users.id = ${user!.id} AND users.role = ${Roles.USER};
			`) as Array<User>;

    await db`COMMIT`;

    return ctx.json(new UserResponse(updatedUser[0]).toJSON());
  }
}
