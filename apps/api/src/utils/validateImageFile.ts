/**
 * Server-side image upload validation.
 *
 * The shared request schema defines the limits; this enforces them at the
 * controller boundary so invalid files never reach ImageKit (no cost, no
 * third-party side effects).
 */

export const MAX_IMAGE_SIZE = 5_000_000;

const ACCEPTED_MIME_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/gif",
  "image/webp",
  "image/heif",
  "image/heic",
]);

const Uint8 = Uint8Array;

function startsWith(bytes: Uint8Array, expected: Array<number>, offset = 0) {
  return expected.every((byte, index) => bytes[offset + index] === byte);
}

/** ASCII "RIFF"/"ftyp" style checks used by webp and heif containers. */
function ascii(bytes: Uint8Array, offset: number, length: number) {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

/**
 * Checks that the first bytes of the file match its declared MIME type.
 */
export function signatureMatches(mimeType: string, bytes: Uint8Array): boolean {
  switch (mimeType) {
    case "image/jpeg":
      return startsWith(bytes, [0xff, 0xd8, 0xff]);
    case "image/png":
      return startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case "image/gif":
      return ascii(bytes, 0, 4) === "GIF8";
    case "image/webp":
      return ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP";
    case "image/heif":
    case "image/heic":
      // ISO base media file: 'ftyp' box at offset 4 with a known brand.
      return (
        ascii(bytes, 4, 4) === "ftyp" &&
        ["heic", "heix", "hevc", "hevx", "mif1", "msf1"].includes(
          ascii(bytes, 8, 4),
        )
      );
    default:
      return false;
  }
}

/**
 * Validates an uploaded image file. Returns an empty array when valid, or a
 * list of error codes understood by the API client.
 */
export async function validateImageFile(
  file: File | undefined,
): Promise<Array<string>> {
  if (!file) {
    return ["file_not_found"];
  }

  const errors: Array<string> = [];

  if (file.size > MAX_IMAGE_SIZE) {
    errors.push("file_too_large");
  }

  if (!ACCEPTED_MIME_TYPES.has(file.type)) {
    errors.push("file_type_not_supported");
  }

  const signature = new Uint8(await file.slice(0, 16).arrayBuffer());
  if (!signatureMatches(file.type, signature)) {
    errors.push("file_signature_mismatch");
  }

  return errors;
}
