/**
 * Object storage adapter (task-6 section 3).
 *
 * Provider-neutral upload/deletion behind one driver seam:
 * - imagekit: hosted default (existing fetch-based integration).
 * - s3: any S3-compatible endpoint (MinIO etc.), self-hosted. Signed with
 *   SigV4 over fetch — no SDK dependency, works on Node and Workers.
 * - local: filesystem driver for single-host self-hosted deployments;
 *   files are served by the API at /files/* (Node runtime only).
 *
 * Driver selection comes from STORAGE_DRIVER (validated centrally).
 */
import type { Context } from "hono";
import { resolvePrismConfig, resolveStorageDriver } from "../config";
import type { Bindings, HonoConfig } from "../types/types";

export type StoredFile = {
  /** Deletion key: ImageKit file id, S3 object key, or local path. */
  fileId: string;
  name: string;
  /** Public URL the browser can fetch. */
  url: string;
  size: number;
};

export type StorageDriver = {
  upload(
    file: File,
    folder: string,
    fileName?: string,
  ): Promise<StoredFile | null>;
  delete(fileId: string): Promise<void>;
};

/** Shared key builder: random name, original extension preserved. */
function buildKey(file: File, folder: string, fileName?: string): string {
  const base = fileName?.trim() || randomId();
  const extension = base.includes(".")
    ? base.slice(base.lastIndexOf("."))
    : "";
  const stem = base.replace(/\.[^/.]+$/, "") || randomId();
  const folderPath = folder.replace(/^\/+|\/+$/g, "");
  return `${folderPath}/${stem}-${randomId()}${extension}`;
}

function randomId(): string {
  return globalThis.crypto.randomUUID().replace(/-/g, "").slice(0, 16);
}

/** ------------------------------------------------------------------ */

/** ImageKit driver (hosted default, also available self-hosted). */
const imagekitDriver = (env: Record<string, string | undefined>): StorageDriver => ({
  async upload(file, folder, fileName) {
    const formData = new FormData();
    formData.append("file", file);
    formData.append("folder", `${env.PROJECT_NAME ?? "prism"}${folder}`);
    formData.append("fileName", fileName || randomId());

    const response = await fetch("https://upload.imagekit.io/api/v1/files/upload", {
      method: "POST",
      body: formData,
      headers: {
        Authorization: `Basic ${btoa(`${env.IMAGE_KIT_API_KEY}:`)}`,
      },
    });
    if (!response.ok) {
      console.warn(
        "[prism-storage] imagekit upload failed:",
        response.status,
      );
      return null;
    }
    const data = (await response.json()) as {
      fileId: string;
      name: string;
      url: string;
      size: number;
    };
    return { fileId: data.fileId, name: data.name, url: data.url, size: data.size };
  },
  async delete(fileId) {
    await fetch(`https://api.imagekit.io/v1/files/${fileId}`, {
      method: "DELETE",
      headers: {
        Authorization: `Basic ${btoa(`${env.IMAGE_KIT_API_KEY}:`)}`,
        "Content-Type": "application/json",
      },
    });
  },
});

/** ------------------------------------------------------------------ */

/**
 * SigV4 request signing over fetch (no SDK). Path-style addressing,
 * which MinIO and most S3-compatible servers support.
 */
async function sha256Hex(data: ArrayBuffer | string): Promise<string> {
  const bytes =
    typeof data === "string" ? new TextEncoder().encode(data) : data;
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

async function hmac(
  key: ArrayBuffer | Uint8Array,
  data: string,
): Promise<Uint8Array> {
  const raw = key instanceof Uint8Array ? key : new Uint8Array(key);
  const importable = new Uint8Array(raw.byteLength);
  importable.set(raw);
  const cryptoKey = await globalThis.crypto.subtle.importKey(
    "raw",
    importable,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(
    await globalThis.crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(data),
    ),
  );
}

async function signatureKey(
  secret: string,
  dateStamp: string,
  region: string,
): Promise<Uint8Array> {
  const kDate = await hmac(new TextEncoder().encode(`AWS4${secret}`), dateStamp);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, "s3");
  return hmac(kService, "aws4_request");
}

async function signedRequest(
  cfg: {
    endpoint: string;
    region: string;
    bucket: string;
    accessKey: string;
    secretKey: string;
  },
  method: "PUT" | "DELETE",
  key: string,
  body?: ArrayBuffer,
): Promise<Response> {
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const host = new URL(cfg.endpoint).host;
  const payloadHash = await sha256Hex(body ?? "");

  const canonicalHeaders =
    `host:${host}\n` +
    `x-amz-content-sha256:${payloadHash}\n` +
    `x-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalUri = `/${cfg.bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const canonicalRequest = `${method}\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${payloadHash}`;

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${await sha256Hex(canonicalRequest)}`;

  const signingKey = await signatureKey(cfg.secretKey, dateStamp, cfg.region);
  const signature = Array.from(await hmac(signingKey, stringToSign))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return fetch(`${cfg.endpoint}${canonicalUri}`, {
    method,
    headers: {
      host,
      "x-amz-content-sha256": payloadHash,
      "x-amz-date": amzDate,
      authorization: `AWS4-HMAC-SHA256 Credential=${cfg.accessKey}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
    body: body ?? undefined,
  });
}

const s3Driver = (env: Record<string, string | undefined>): StorageDriver => {
  const cfg = {
    endpoint: (env.STORAGE_S3_ENDPOINT ?? "").replace(/\/+$/, ""),
    region: env.STORAGE_S3_REGION ?? "us-east-1",
    bucket: env.STORAGE_S3_BUCKET ?? "",
    accessKey: env.STORAGE_S3_ACCESS_KEY_ID ?? "",
    secretKey: env.STORAGE_S3_SECRET_ACCESS_KEY ?? "",
  };
  const publicUrl = (env.STORAGE_PUBLIC_URL ?? "").replace(/\/+$/, "");

  return {
    async upload(file, folder, fileName) {
      const key = buildKey(file, folder, fileName);
      const response = await signedRequest(
        cfg,
        "PUT",
        key,
        await file.arrayBuffer(),
      );
      if (!response.ok) {
        console.warn(
          "[prism-storage] s3 upload failed:",
          response.status,
          await response.text().catch(() => ""),
        );
        return null;
      }
      return {
        fileId: key,
        name: key.split("/").pop() ?? key,
        url: `${publicUrl}/${key}`,
        size: file.size,
      };
    },
    async delete(key) {
      const response = await signedRequest(cfg, "DELETE", key);
      if (!response.ok) {
        console.warn(
          "[prism-storage] s3 delete failed:",
          response.status,
          await response.text().catch(() => ""),
        );
      }
    },
  };
};

/** ------------------------------------------------------------------ */

/** Local filesystem driver (single-host self-hosted; served at /files/*). */
const localDriver = (
  env: Record<string, string | undefined>,
): StorageDriver => {
  const dir = env.STORAGE_LOCAL_DIR ?? "./data/uploads";
  const baseUrl = env.BASE_URL ?? "http://localhost:8787";
  return {
    async upload(file, folder, fileName) {
      // Node-only driver (the Worker has no filesystem).
      const { writeFile, mkdir } = await import("node:fs/promises");
      const path = await import("node:path");
      const key = buildKey(file, folder, fileName);
      const full = path.join(dir, key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, Buffer.from(await file.arrayBuffer()));
      return {
        fileId: key,
        name: key.split("/").pop() ?? key,
        url: `${baseUrl}/files/${key}`,
        size: file.size,
      };
    },
    async delete(key) {
      const { unlink } = await import("node:fs/promises");
      const path = await import("node:path");
      const full = path.resolve(dir, key);
      if (!full.startsWith(path.resolve(dir) + path.sep)) {
        return; // traversal guard: never delete outside the store
      }
      await unlink(full).catch(() => undefined);
    },
  };
};

/** ------------------------------------------------------------------ */

export class StorageManager {
  public static getDriver(ctx: Context<HonoConfig>): StorageDriver {
    const env = ctx.env as unknown as Record<string, string | undefined>;
    const config = resolvePrismConfig(env);
    switch (resolveStorageDriver(env)) {
      case "imagekit":
        return imagekitDriver(env);
      case "s3":
        return s3Driver(env);
      case "local":
        return localDriver(env);
      default:
        // Unreachable: resolveStorageDriver validates the value.
        throw new Error(`Unsupported STORAGE_DRIVER for ${config.deploymentMode}.`);
    }
  }

  public static async uploadSingle(
    ctx: Context<HonoConfig>,
    file: File,
    folder: string,
    fileName?: string,
  ): Promise<StoredFile | null> {
    return StorageManager.getDriver(ctx).upload(file, folder, fileName);
  }

  public static async deleteFile(
    ctx: Context<HonoConfig>,
    fileId: string,
  ): Promise<void> {
    await StorageManager.getDriver(ctx).delete(fileId);
  }

  /** Absolute local path for the /files/* static route (local driver). */
  public static async localFilePath(
    ctx: Context<HonoConfig>,
    key: string,
  ): Promise<string | null> {
    const env = ctx.env as unknown as Record<string, string | undefined>;
    if (resolveStorageDriver(env) !== "local") {
      return null;
    }
    const { resolve, sep } = await import("node:path");
    const dir = resolve(env.STORAGE_LOCAL_DIR ?? "./data/uploads");
    // Percent-decoded traversal (%2e%2e) is a real key, not a separator:
    // decode before resolving so the containment check sees the true path.
    let decoded = key;
    try {
      decoded = decodeURIComponent(key);
    } catch {
      // Malformed escape sequences are rejected by the containment check.
    }
    const full = resolve(dir, decoded);
    if (!full.startsWith(dir + sep)) {
      return null; // traversal guard
    }
    return full;
  }
}
