import type { Context } from "hono";
import type { HonoConfig } from "../types/types";
import {
  type UpdateUserInformationRequest,
  UpdateUserInformationRequestSchema,
} from "@prism/types";
import { validateData } from "../utils/validateData";
import { DatabaseManager } from "../managers/DatabaseManager";
import { ErrorResponse } from "../network/responses/ErrorResponse";
import { validateImageFile } from "../utils/validateImageFile";
import { OkResponse } from "../network/responses/OkResponse";
import type { Profile } from "../models/Profile";
import { UserResponse } from "../network/responses/UserResponse";
import { UploadController } from "./UploadController";
import type { ProfilePicture } from "../models/ProfilePicture";
import { ProfilePictureResponse } from "../network/responses/ProfilePictureResponse";

export class UserController {
  /**
   * Returns the authenticated Prism user (identity from Better Auth) with
   * their product profile (first/last name, avatar, verification state).
   */
  public static async currentUser(ctx: Context<HonoConfig>) {
    const user = ctx.get("user");
    if (!user) {
      return ctx.json(new ErrorResponse("unauthorized").toJSON(), 401);
    }

    const profile =
      (await DatabaseManager.getInstance(
        ctx,
      )`SELECT * FROM profiles WHERE user_id = ${user.id} LIMIT 1`) as Array<Profile>;

    return ctx.json(
      new UserResponse(user, profile[0] ?? null).toJSON(),
    );
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

    const updated = (await DatabaseManager.getInstance(ctx)`
      UPDATE profiles SET first_name = ${data.firstName}, last_name = ${data.lastName}
      WHERE user_id = ${user.id} RETURNING *
    `) as Array<Profile>;

    if (updated.length === 0) {
      return ctx.json(new ErrorResponse("profile_not_updated").toJSON(), 400);
    }

    return ctx.json(
      new UserResponse(user, updated[0]).toJSON(),
    );
  }
}
