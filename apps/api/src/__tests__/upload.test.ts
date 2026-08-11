import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { UserController } from "../controllers/UserController";
import { makeMockDb, makeCtx } from "./helpers";

vi.mock("../managers/DatabaseManager", () => ({
  DatabaseManager: { getInstance: vi.fn() },
}));

const mocks = vi.hoisted(() => ({
  uploadSingle: vi.fn(),
  deleteFile: vi.fn(),
}));
vi.mock("../managers/StorageManager", () => ({
  StorageManager: mocks,
}));

import { DatabaseManager } from "../managers/DatabaseManager";

const getInstance = vi.mocked(DatabaseManager.getInstance);

const USER_ID = "11111111-1111-1111-1111-111111111111";

const PNG_BYTES = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
]);
const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);

function makeImageFile(bytes: Uint8Array, type: string, name = "avatar.png") {
  return new File([bytes as unknown as BlobPart], name, { type });
}

function ctxWithFile(file: File | undefined) {
  const ctx = makeCtx({}, {}, {
    user: { id: USER_ID, user_name: null },
  });
  (ctx as never as { req: { parseBody: unknown } }).req.parseBody = vi.fn(
    async () => ({ file }),
  );
  return ctx;
}

describe("UserController.updateProfilePicture (upload validation)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function mockStorage(ok = true) {
    mocks.uploadSingle.mockResolvedValue(
      ok
        ? {
            fileId: "f1",
            name: "avatar.png",
            url: "https://ik.imagekit.io/prism/avatar.png",
            size: 1234,
          }
        : null,
    );
    mocks.deleteFile.mockResolvedValue(undefined);
  }

  it("accepts a valid image and forwards it to storage", async () => {
    mockStorage();
    const query = makeMockDb((sql) => {
      if (sql.includes("SELECT profile_picture_id")) return [];
      if (sql.includes("INSERT INTO profile_pictures")) return [];
      return [];
    });
    getInstance.mockReturnValue(query as never);

    const result = await UserController.updateProfilePicture(
      ctxWithFile(makeImageFile(PNG_BYTES, "image/png")),
    );

    expect(mocks.uploadSingle).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({
      __json: { profilePictureUrl: "https://ik.imagekit.io/prism/avatar.png" },
    });
  });

  it("rejects an oversized file before any storage request", async () => {
    mockStorage();
    const big = new Uint8Array(5_000_001);

    const result = await UserController.updateProfilePicture(
      ctxWithFile(makeImageFile(big, "image/png")),
    );

    expect(mocks.uploadSingle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ __json: { errors: expect.arrayContaining(["file_too_large"]) } });
  });

  it("rejects an unsupported MIME type", async () => {
    mockStorage();

    const result = await UserController.updateProfilePicture(
      ctxWithFile(makeImageFile(JPEG_BYTES, "text/plain")),
    );

    expect(mocks.uploadSingle).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      __json: { errors: expect.arrayContaining(["file_type_not_supported"]) },
    });
  });

  it("rejects a missing file", async () => {
    mockStorage();

    const result = await UserController.updateProfilePicture(ctxWithFile(undefined));

    expect(mocks.uploadSingle).not.toHaveBeenCalled();
    expect(result).toMatchObject({ __json: { errors: expect.arrayContaining(["file_not_found"]) } });
  });

  it("rejects content whose signature does not match its declared MIME type", async () => {
    mockStorage();

    // Declared PNG, actual JPEG bytes.
    const result = await UserController.updateProfilePicture(
      ctxWithFile(makeImageFile(JPEG_BYTES, "image/png")),
    );

    expect(mocks.uploadSingle).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      __json: { errors: expect.arrayContaining(["file_signature_mismatch"]) },
    });
  });
});
