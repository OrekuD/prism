/**
 * Server-only snapshot query-context tokens (Task 21, R1-F1).
 *
 * The shared types package freezes only the OPAQUE token string shape.
 * Issuance and verification live here so signing keys never enter the
 * browser bundle: the token is `base64url(payload).base64url(HMAC-SHA256)`
 * over the payload segment with a server-held key.
 *
 * Verification binds the token to project, organization, immutable range,
 * comparison range, snapshot cutoff, allowed source IDs, definition
 * version, and expiry. Callers must additionally re-check membership and
 * confirm every source belongs to the project (slice 6 wires this to the
 * controller boundary).
 */
import { z } from "zod";

export const QUERY_CONTEXT_TOKEN_VERSION = 1;

/** Seven-day token lifetime: snapshots stay refreshable, never immortal. */
export const QUERY_CONTEXT_TOKEN_TTL_MS = 7 * 86_400_000;

const TokenPayloadSchema = z.strictObject({
  v: z.literal(QUERY_CONTEXT_TOKEN_VERSION),
  kid: z.string().min(1).max(64),
  projectId: z.string().min(1).max(128),
  organizationId: z.string().min(1).max(128),
  from: z.number().int().nonnegative(),
  to: z.number().int().nonnegative(),
  compareFrom: z.number().int().nonnegative(),
  compareTo: z.number().int().nonnegative(),
  asOf: z.number().int().nonnegative(),
  issuedAt: z.number().int().nonnegative(),
  exp: z.number().int().nonnegative(),
  sourceIds: z.array(z.string().min(1).max(128)).max(64),
  definitionVersion: z.literal(1),
});

export type QueryContextTokenPayload = z.infer<typeof TokenPayloadSchema>;

export type VerifiedQueryContext = {
  projectId: string;
  organizationId: string;
  from: number;
  to: number;
  compareFrom: number;
  compareTo: number;
  asOf: number;
  timezone: "UTC";
  sourceIds: readonly string[];
  definitionVersion: number;
};

export type TokenVerifyFailure =
  | "malformed"
  | "unknown-key"
  | "bad-signature"
  | "expired"
  | "scope-mismatch"
  | "range-invalid"
  | "source-not-allowed"
  | "version-mismatch";

export type TokenVerifyResult =
  | { ok: true; context: VerifiedQueryContext }
  | { ok: false; reason: TokenVerifyFailure };

const textEncoder = new TextEncoder();

const base64UrlEncodeBytes = (bytes: Uint8Array): string => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  if (typeof Buffer !== "undefined") {
    return (
      Buffer as unknown as {
        from(s: string, e: string): { toString(e: string): string };
      }
    )
      .from(binary, "binary")
      .toString("base64url");
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
};

const base64UrlDecodeBytes = (segment: string): Uint8Array | null => {
  try {
    if (typeof Buffer !== "undefined") {
      const buffer = (
        Buffer as unknown as {
          from(s: string, e: string): Uint8Array;
        }
      ).from(segment, "base64url");
      return new Uint8Array(buffer);
    }
    let b64 = segment.replace(/-/g, "+").replace(/_/g, "/");
    while (b64.length % 4) b64 += "=";
    const binary = atob(b64);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return bytes;
  } catch {
    return null;
  }
};

async function importKey(secret: string): Promise<CryptoKey> {
  return globalThis.crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

async function signSegment(segment: string, secret: string): Promise<string> {
  const key = await importKey(secret);
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    textEncoder.encode(segment),
  );
  return base64UrlEncodeBytes(new Uint8Array(signature));
}

/** Issue a signed token. `issuedAt` defaults to now; tests inject time. */
export async function issueQueryContextToken(
  input: {
    projectId: string;
    organizationId: string;
    from: number;
    to: number;
    compareFrom: number;
    compareTo: number;
    asOf: number;
    sourceIds: readonly string[];
  },
  key: { kid: string; secret: string },
  issuedAt: number = Date.now(),
): Promise<string> {
  const payload: QueryContextTokenPayload = {
    v: QUERY_CONTEXT_TOKEN_VERSION,
    kid: key.kid,
    projectId: input.projectId,
    organizationId: input.organizationId,
    from: input.from,
    to: input.to,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
    asOf: input.asOf,
    issuedAt,
    exp: issuedAt + QUERY_CONTEXT_TOKEN_TTL_MS,
    sourceIds: [...input.sourceIds],
    definitionVersion: 1,
  };
  const segment = base64UrlEncodeBytes(
    textEncoder.encode(JSON.stringify(payload)),
  );
  const signature = await signSegment(segment, key.secret);
  return `${segment}.${signature}`;
}

export type TokenVerifyOptions = {
  /** Key set by kid — supports rotation (previous keys verify, then drop). */
  keys: Record<string, string>;
  now?: number;
  projectId: string;
  organizationId: string;
  /** Project's current source IDs; token sources must be a subset. */
  allowedSourceIds?: readonly string[];
};

const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let index = 0; index < a.length; index += 1) {
    diff |= (a[index] ?? 0) ^ (b[index] ?? 0);
  }
  return diff === 0;
};

/**
 * Verify a token against the key set, scope, ranges, sources, and expiry.
 * Never throws for untrusted input — every failure is a typed reason.
 */
export async function verifyQueryContextToken(
  token: string,
  options: TokenVerifyOptions,
): Promise<TokenVerifyResult> {
  const now = options.now ?? Date.now();
  if (!token || token.length > 4096) return { ok: false, reason: "malformed" };
  const dot = token.indexOf(".");
  if (
    dot <= 0 ||
    dot === token.length - 1 ||
    token.indexOf(".", dot + 1) !== -1
  ) {
    return { ok: false, reason: "malformed" };
  }
  const segment = token.slice(0, dot);
  const signatureSegment = token.slice(dot + 1);
  const payloadBytes = base64UrlDecodeBytes(segment);
  const signatureBytes = base64UrlDecodeBytes(signatureSegment);
  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: "malformed" };
  }
  let payloadJson: string;
  try {
    payloadJson = new TextDecoder().decode(payloadBytes);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  const payloadResult = TokenPayloadSchema.safeParse(parsed);
  if (!payloadResult.success) return { ok: false, reason: "malformed" };
  const payload = payloadResult.data;
  if (payload.v !== QUERY_CONTEXT_TOKEN_VERSION) {
    return { ok: false, reason: "version-mismatch" };
  }
  const secret = options.keys[payload.kid];
  if (!secret) return { ok: false, reason: "unknown-key" };
  const key = await importKey(secret);
  let valid = false;
  try {
    valid =
      signatureBytes.length === 32 &&
      (await globalThis.crypto.subtle.verify(
        "HMAC",
        key,
        signatureBytes as unknown as ArrayBuffer,
        textEncoder.encode(segment),
      ));
  } catch {
    valid = false;
  }
  // Fall back to a manual comparison only when subtle.verify is
  // unavailable; both paths reject forged payloads.
  if (!valid) {
    const expected = base64UrlDecodeBytes(await signSegment(segment, secret));
    valid = !!expected && timingSafeEqual(signatureBytes, expected);
  }
  if (!valid) return { ok: false, reason: "bad-signature" };
  if (now >= payload.exp) return { ok: false, reason: "expired" };
  if (
    payload.projectId !== options.projectId ||
    payload.organizationId !== options.organizationId
  ) {
    return { ok: false, reason: "scope-mismatch" };
  }
  if (
    payload.from >= payload.to ||
    payload.compareFrom >= payload.compareTo ||
    payload.to - payload.from !== payload.compareTo - payload.compareFrom
  ) {
    return { ok: false, reason: "range-invalid" };
  }
  if (options.allowedSourceIds) {
    const allowed = new Set(options.allowedSourceIds);
    if (!payload.sourceIds.every((id) => allowed.has(id))) {
      return { ok: false, reason: "source-not-allowed" };
    }
  }
  return {
    ok: true,
    context: {
      projectId: payload.projectId,
      organizationId: payload.organizationId,
      from: payload.from,
      to: payload.to,
      compareFrom: payload.compareFrom,
      compareTo: payload.compareTo,
      asOf: payload.asOf,
      timezone: "UTC",
      sourceIds: payload.sourceIds,
      definitionVersion: payload.definitionVersion,
    },
  };
}
