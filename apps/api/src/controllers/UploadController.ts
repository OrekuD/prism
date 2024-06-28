import { Context } from "hono";
import { HonoConfig } from "../types/types";
import crypto from "node:crypto";
import { ImageKitIOResource } from "@prism/types";

export default class UploadController {
  private static imageKitUploadUrl = "https://upload.imagekit.io/api/v1/files";

  public static async uploadSingle(
    ctx: Context<HonoConfig>,
    file: File,
    folder: string,
    fileName?: string,
  ): Promise<ImageKitIOResource | null> {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", "Bazaar/" + folder);
    formData.append(
      "fileName",
      fileName || crypto.randomBytes(32).toString("hex"),
    );

    const response = await fetch(`${this.imageKitUploadUrl}/upload`, {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Basic ${btoa(ctx.env.IMAGE_KIT_API_KEY + ":")}`,
      },
    });

    const data = (await response.json()) as ImageKitIOResource;

    if (!data.url) {
      return null;
    }

    return data;
  }

  public static async deleteFile(
    ctx: Context<HonoConfig>,
    fileId: string,
  ): Promise<void> {
    await fetch(`${this.imageKitUploadUrl}/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(ctx.env.IMAGE_KIT_API_KEY + ":")}`,
      },
    });
  }
}
