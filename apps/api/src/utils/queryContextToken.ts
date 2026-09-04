/**
 * Server-only snapshot query-context tokens (Task 21, R1-F1, revised R2-F1).
 *
 * The shared types package freezes only the OPAQUE token string shape.
 * Issuance and verification live here so signing keys never enter the
 * browser bundle: the token is `base64url(payload).base64url(HMAC-SHA256)`
 * over the payload segment with a server-held key.
 *
 * Verification binds the token to project, organization, canonical
 * comparison semantics (`compareTo === from`, equal lengths), snapshot
 * chronology, the project's current source set (always required), the
 * definition version, and expiry. Callers additionally re-check membership
 * (slice 6 wires `allowedSourceIds` from the frozen run-scoped
 * `AuthorizedProjectContext`, including an empty set when appropriate).
 */
import { z } from "zod";

export const QUERY_CONTEXT_TOKEN_VERSION = 1;

/** Seven-day token lifetime: snapshots stay refreshable, never immortal. */
export const QUERY_CONTEXT_TOKEN_TTL_MS = 7 * 86_400_000;

/** Documented clock-skew allowance for issuedAt/asOf comparisons. */
export const QUERY_CONTEXT_TOKEN_CLOCK_SKEW_MS = 60_000;

/** Maximum accepted window length: catches garbage without capping v1 ranges. */
export const QUERY_CONTEXT_TOKEN_MAX_WINDOW_MS = 366 * 86_400_000;

/** Exported for issuance-time parsing: what we sign must verify. */
export const TokenPayloadSchema = z.strictObject({
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
  sourceScope: z.enum(["all", "selected"]),
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
  sourceScope: "all" | "selected";
  sourceIds: readonly string[];
  definitionVersion: number;
};

export type TokenVerifyFailure =
  | "malformed"
  | "version-mismatch"
  | "unknown-key"
  | "bad-signature"
  | "expired"
  | "scope-mismatch"
  | "range-invalid"
  | "invalid-timestamps"
  | "duplicate-sources"
  | "source-not-allowed";

export type TokenVerifyResult =
  | { ok: true; context: VerifiedQueryContext }
  | { ok: false; reason: TokenVerifyFailure };

export type ContextSemantics = {
  from: number;
  to: number;
  compareFrom: number;
  compareTo: number;
  asOf: number;
  issuedAt: number;
  now: number;
  sourceScope?: "all" | "selected";
  sourceIds: readonly string[];
  ttlMs: number;
  clockSkewMs: number;
};

export type SemanticsFailure =
  "range-invalid" | "invalid-timestamps" | "duplicate-sources";

/**
 * One server-only semantic validator used at BOTH issuance and
 * verification, so no caller can accept what issuance would refuse:
 * positive bounded windows, the canonical immediately-preceding
 * comparison (`compareTo === from`, equal lengths), `asOf >= to` with a
 * sane `asOf <= issuedAt <= now` chronology (plus explicit skew), and
 * duplicate-free source IDs.
 */
export function validateQueryContextSemantics(
  semantics: ContextSemantics,
): { ok: true } | { ok: false; reason: SemanticsFailure } {
  const window = semantics.to - semantics.from;
  const compareWindow = semantics.compareTo - semantics.compareFrom;
  if (
    !Number.isInteger(semantics.from) ||
    window <= 0 ||
    window > QUERY_CONTEXT_TOKEN_MAX_WINDOW_MS ||
    compareWindow <= 0 ||
    compareWindow > QUERY_CONTEXT_TOKEN_MAX_WINDOW_MS
  ) {
    return { ok: false, reason: "range-invalid" };
  }
  if (semantics.compareTo !== semantics.from || window !== compareWindow) {
    return { ok: false, reason: "range-invalid" };
  }
  if (semantics.asOf < semantics.to) {
    return { ok: false, reason: "invalid-timestamps" };
  }
  if (
    semantics.asOf > semantics.issuedAt + semantics.clockSkewMs ||
    semantics.issuedAt > semantics.now + semantics.clockSkewMs ||
    semantics.asOf > semantics.now + semantics.clockSkewMs
  ) {
    return { ok: false, reason: "invalid-timestamps" };
  }
  if (new Set(semantics.sourceIds).size !== semantics.sourceIds.length) {
    return { ok: false, reason: "duplicate-sources" };
  }
  // R4-F1: `all` must carry an empty list so an explicit empty intersection
  // (`selected` + `[]`) can never alias the unfiltered scope. Old payloads
  // without a scope fail the strict schema before reaching here.
  if (
    semantics.sourceScope === "all" &&
    semantics.sourceIds.length > 0
  ) {
    return { ok: false, reason: "range-invalid" };
  }
  return { ok: true };
}

/**
 * Configuration-time key validation: non-empty set, non-blank IDs and
 * secrets of sane length. Fails fast at startup instead of issuing
 * unverifiable (or trivially forgeable) tokens.
 */
export function validateTokenKeys(keys: Record<string, string>): void {
  const kids = Object.keys(keys);
  if (kids.length === 0) {
    throw new TypeError("At least one query-context signing key is required");
  }
  for (const kid of kids) {
    const secret = (keys as Record<string, string | undefined>)[kid];
    if (!kid || kid.length > 64) {
      throw new TypeError("Token signing key IDs must be 1-64 characters");
    }
    if (!secret || secret.length < 16) {
      throw new TypeError(
        `Token signing secret for kid "${kid}" must be at least 16 characters`,
      );
    }
  }
}

/**
 * Resolve the effective token-key configuration from API bindings (R4-F3).
 * Validates the kid + secret with the same policy as `validateTokenKeys`
 * on EVERY call and returns the branded pair — issuance and verification
 * never accept a raw env string. Only the validated configuration is
 * cached by callers, never a successful authorization decision.
 */
export function resolveTokenKeyConfig(env: {
  QUERY_CONTEXT_TOKEN_KEY?: string;
  QUERY_CONTEXT_TOKEN_KID?: string;
}): { kid: string; secret: string } {
  const kid = env.QUERY_CONTEXT_TOKEN_KID ?? "k1";
  const secret = env.QUERY_CONTEXT_TOKEN_KEY ?? "";
  validateTokenKeys({ [kid]: secret });
  return { kid, secret };
}

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

export type IssueTokenOptions = {
  issuedAt?: number;
  ttlMs?: number;
};

/**
 * Issue a signed token. Runs the shared semantic validator first, so
 * invalid contexts throw instead of producing accepted tokens. `ttlMs`
 * exists for rotation/deployment configuration; verification checks the
 * embedded lifetime against the expected TTL.
 *
 * Defensive key policy (R4-F3): issuance enforces the same 16-char minimum
 * as configuration-time `validateTokenKeys`, so a future caller cannot
 * bypass startup validation with a one-character secret.
 */
export async function issueQueryContextToken(
  input: {
    projectId: string;
    organizationId: string;
    from: number;
    to: number;
    compareFrom: number;
    compareTo: number;
    asOf: number;
    sourceScope: "all" | "selected";
    sourceIds: readonly string[];
  },
  key: { kid: string; secret: string },
  issuedAt: number = Date.now(),
  options: IssueTokenOptions = {},
): Promise<string> {
  if (!key.kid || key.kid.length > 64) {
    throw new TypeError("Token signing key IDs must be 1-64 characters");
  }
  if (!key.secret || key.secret.length < 16) {
    throw new TypeError(
      `Token signing secret for kid "${key.kid || "unknown"}" must be at least 16 characters`,
    );
  }
  const ttlMs = options.ttlMs ?? QUERY_CONTEXT_TOKEN_TTL_MS;
  const at = options.issuedAt ?? issuedAt;
  const semantics = validateQueryContextSemantics({
    from: input.from,
    to: input.to,
    compareFrom: input.compareFrom,
    compareTo: input.compareTo,
    asOf: input.asOf,
    issuedAt: at,
    now: at,
    sourceScope: input.sourceScope,
    sourceIds: input.sourceIds,
    ttlMs,
    clockSkewMs: QUERY_CONTEXT_TOKEN_CLOCK_SKEW_MS,
  });
  if (!semantics.ok) {
    throw new TypeError(
      `Refusing to issue a token with invalid context: ${semantics.reason}`,
    );
  }
  if (input.sourceScope === "all" && input.sourceIds.length > 0) {
    throw new TypeError(
      "Refusing to issue an all-scope token with source IDs",
    );
  }
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
    issuedAt: at,
    exp: at + ttlMs,
    sourceScope: input.sourceScope,
    sourceIds: [...input.sourceIds],
    definitionVersion: 1,
  };
  // Parse what we sign (R3-F1): issuance and verification share the exact
  // schema and limits, so a project with >64 sources can never receive a
  // token its own verifier rejects as malformed.
  const checked = TokenPayloadSchema.safeParse(payload);
  if (!checked.success) {
    throw new TypeError("Refusing to issue a token that fails its own schema");
  }
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
  /**
   * The project's current source set — REQUIRED, never optional. Pass the
   * frozen run-scoped `AuthorizedProjectContext.allowedSourceIds`,
   * including an empty set when the project has no sources.
   */
  allowedSourceIds: readonly string[];
  /** Expected token lifetime; embedded `exp - issuedAt` must match. */
  ttlMs?: number;
  clockSkewMs?: number;
};

/**
 * Verify a token against the key set, scope, canonical semantics, sources,
 * and expiry. Never throws for untrusted input — every failure is a typed
 * reason. Unknown token versions report `version-mismatch` (not
 * `malformed`) so future rotations are observable.
 */
export async function verifyQueryContextToken(
  token: string,
  options: TokenVerifyOptions,
): Promise<TokenVerifyResult> {
  const now = options.now ?? Date.now();
  const ttlMs = options.ttlMs ?? QUERY_CONTEXT_TOKEN_TTL_MS;
  const clockSkewMs = options.clockSkewMs ?? QUERY_CONTEXT_TOKEN_CLOCK_SKEW_MS;
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
  if (!parsed || typeof parsed !== "object") {
    return { ok: false, reason: "malformed" };
  }
  const version = (parsed as { v?: unknown }).v;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return { ok: false, reason: "malformed" };
  }
  if (version !== QUERY_CONTEXT_TOKEN_VERSION) {
    return { ok: false, reason: "version-mismatch" };
  }
  const payloadResult = TokenPayloadSchema.safeParse(parsed);
  if (!payloadResult.success) return { ok: false, reason: "malformed" };
  const payload = payloadResult.data;
  // Own-property lookup: a `__proto__` kid must not resolve a prototype.
  const secret = Object.prototype.hasOwnProperty.call(options.keys, payload.kid)
    ? options.keys[payload.kid]
    : undefined;
  if (!secret) return { ok: false, reason: "unknown-key" };
  const key = await importKey(secret);
  // Owned copy: subtle.verify needs a BufferSource backed by ArrayBuffer.
  const signatureCopy = new Uint8Array(signatureBytes);
  let valid = false;
  try {
    valid =
      signatureCopy.length === 32 &&
      (await globalThis.crypto.subtle.verify(
        "HMAC",
        key,
        signatureCopy.buffer,
        textEncoder.encode(segment),
      ));
  } catch {
    valid = false;
  }
  if (!valid) return { ok: false, reason: "bad-signature" };
  if (payload.exp - payload.issuedAt !== ttlMs) {
    return { ok: false, reason: "invalid-timestamps" };
  }
  if (now >= payload.exp) return { ok: false, reason: "expired" };
  if (
    payload.projectId !== options.projectId ||
    payload.organizationId !== options.organizationId
  ) {
    return { ok: false, reason: "scope-mismatch" };
  }
  const semantics = validateQueryContextSemantics({
    from: payload.from,
    to: payload.to,
    compareFrom: payload.compareFrom,
    compareTo: payload.compareTo,
    asOf: payload.asOf,
    issuedAt: payload.issuedAt,
    now,
    sourceScope: payload.sourceScope,
    sourceIds: payload.sourceIds,
    ttlMs,
    clockSkewMs,
  });
  if (!semantics.ok) {
    return { ok: false, reason: semantics.reason };
  }
  const allowed = new Set(options.allowedSourceIds);
  if (!payload.sourceIds.every((id) => allowed.has(id))) {
    return { ok: false, reason: "source-not-allowed" };
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
      sourceScope: payload.sourceScope,
      sourceIds: payload.sourceIds,
      definitionVersion: payload.definitionVersion,
    },
  };
}
