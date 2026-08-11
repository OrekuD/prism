import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StorageManager } from "../managers/StorageManager";

/**
 * Object-storage adapter tests: local filesystem driver (real disk), the
 * S3 driver (SigV4 signing over mocked fetch), the ImageKit driver, and
 * driver selection by configuration.
 */

const baseEnv = {
  DATABASE_URL: "postgres://test",
  JWT_SECRET_KEY: "x".repeat(48),
  CLIENT_URL: "http://localhost:3001",
  BASE_URL: "http://localhost:8787",
  IMAGE_KIT_API_KEY: "test-imagekit-key",
  PRISM_DEPLOYMENT_MODE: "self-hosted",
  ENVIRONMENT: "development",
  SETUP_TOKEN: "test-setup-token-123456",
};

function makeCtx(env: Record<string, string | undefined> = baseEnv) {
  return {
    env: { ...baseEnv, ...env },
    req: { header: () => undefined, raw: { headers: new Headers() } },
  } as never;
}

function makeImageFile(name = "avatar.png") {
  return new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], name, {
    type: "image/png",
  });
}

let tempDir = "";

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), "prism-storage-"));
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
  vi.unstubAllGlobals();
});

describe("local driver", () => {
  it("writes the file and returns a served URL", async () => {
    const result = await StorageManager.uploadSingle(
      makeCtx({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: tempDir }),
      makeImageFile(),
      "/users/profile-pictures",
      "avatar.png",
    );

    expect(result).not.toBeNull();
    expect(result?.url).toMatch(/^http:\/\/localhost:8787\/files\//);
    const fileId = result?.fileId ?? "";
    const onDisk = await readFile(join(tempDir, fileId));
    expect(onDisk[0]).toBe(0x89);
    expect((await stat(join(tempDir, fileId))).size).toBe(4);
  });

  it("deletes the file by key", async () => {
    const ctx = makeCtx({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: tempDir });
    const result = await StorageManager.uploadSingle(ctx, makeImageFile(), "/x");
    const fileId = result?.fileId ?? "";
    await StorageManager.deleteFile(ctx, fileId);
    await expect(stat(join(tempDir, fileId))).rejects.toThrow();
  });

  it("refuses paths outside the store (traversal guard)", async () => {
    const ctx = makeCtx({ STORAGE_DRIVER: "local", STORAGE_LOCAL_DIR: tempDir });
    const path = await StorageManager.localFilePath(ctx, "../../etc/passwd");
    expect(path).toBeNull();
    const escaped = await StorageManager.localFilePath(ctx, "%2e%2e/secret");
    expect(escaped).toBeNull();
  });

  it("serves nothing when a different driver is active", async () => {
    const ctx = makeCtx(s3Env());
    expect(await StorageManager.localFilePath(ctx, "a.png")).toBeNull();
  });
});

function s3Env() {
  return {
    STORAGE_DRIVER: "s3",
    STORAGE_S3_ENDPOINT: "http://localhost:9000",
    STORAGE_S3_REGION: "us-east-1",
    STORAGE_S3_BUCKET: "prism",
    STORAGE_S3_ACCESS_KEY_ID: "minioadmin",
    STORAGE_S3_SECRET_ACCESS_KEY: "minioadmin-secret",
    STORAGE_PUBLIC_URL: "http://localhost:9000/prism",
  };
}

describe("s3 driver", () => {
  it("PUTs the object with a SigV4 authorization header", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await StorageManager.uploadSingle(
      makeCtx(s3Env()),
      makeImageFile(),
      "/users/profile-pictures",
      "avatar.png",
    );

    expect(result).not.toBeNull();
    expect(result?.url).toMatch(/^http:\/\/localhost:9000\/prism\//);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/^http:\/\/localhost:9000\/prism\/users\/profile-pictures\//);
    expect(init.method).toBe("PUT");
    const auth = (init.headers as Record<string, string>).authorization;
    expect(auth).toMatch(/^AWS4-HMAC-SHA256 Credential=minioadmin\//);
    expect(auth).toContain("SignedHeaders=host;x-amz-content-sha256;x-amz-date");
  });

  it("DELETEs the object by key", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);

    await StorageManager.deleteFile(makeCtx(s3Env()), "users/a/avatar-1.png");

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/prism/users/a/avatar-1.png");
    expect(init.method).toBe("DELETE");
  });

  it("returns null when the endpoint rejects the upload", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, _init?: RequestInit) => new Response("AccessDenied", { status: 403 })),
    );
    const result = await StorageManager.uploadSingle(
      makeCtx(s3Env()),
      makeImageFile(),
      "/x",
    );
    expect(result).toBeNull();
  });
});

describe("imagekit driver", () => {
  it("uploads through the ImageKit API with basic auth", async () => {
    const fetchMock = vi.fn(
      async (_url: string, _init?: RequestInit) =>
        new Response(
          JSON.stringify({
            fileId: "ik-1",
            name: "avatar.png",
            url: "https://ik.imagekit.io/prism/avatar.png",
            size: 4,
          }),
          { status: 200 },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await StorageManager.uploadSingle(
      makeCtx({ STORAGE_DRIVER: "imagekit" }),
      makeImageFile(),
      "/users/profile-pictures",
      "avatar.png",
    );

    expect(result?.fileId).toBe("ik-1");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://upload.imagekit.io/api/v1/files/upload");
    const headers = new Headers(init.headers as HeadersInit);
    expect(headers.get("authorization")).toMatch(/^Basic /);
  });

  it("deletes through the ImageKit API", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    await StorageManager.deleteFile(makeCtx({ STORAGE_DRIVER: "imagekit" }), "ik-1");
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe("https://api.imagekit.io/v1/files/ik-1");
  });
});

describe("driver selection", () => {
  it("hosted defaults to imagekit", async () => {
    const ctx = makeCtx({ PRISM_DEPLOYMENT_MODE: "hosted" });
    // imagekit driver performs network I/O on upload; selection is proven
    // by the absence of the local/s3 code paths — the upload goes to
    // imagekit's endpoint.
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);
    await StorageManager.uploadSingle(ctx, makeImageFile(), "/x");
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("imagekit.io");
  });

  it("self-hosted without STORAGE_DRIVER defaults to local", async () => {
    const result = await StorageManager.uploadSingle(
      makeCtx({ STORAGE_LOCAL_DIR: tempDir }),
      makeImageFile(),
      "/users/profile-pictures",
      "avatar.png",
    );
    expect(result?.url).toMatch(/\/files\//);
  });

  it("rejects unknown driver values", () => {
    const ctx = makeCtx({ STORAGE_DRIVER: "ftp" });
    expect(() => StorageManager.getDriver(ctx)).toThrow(/STORAGE_DRIVER/);
  });
});
