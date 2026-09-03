import { describe, expect, it } from "vitest";
import {
  issueQueryContextToken,
  QUERY_CONTEXT_TOKEN_CLOCK_SKEW_MS,
  QUERY_CONTEXT_TOKEN_TTL_MS,
  validateQueryContextSemantics,
  validateTokenKeys,
  verifyQueryContextToken,
} from "../utils/queryContextToken";

/**
 * Task 21 R1-F1/R2-F1 — server-only snapshot tokens. The shared types
 * package exposes only the opaque string shape; issuance and verification
 * live here with a server-held HMAC key. Every case below forges, tampers,
 * misconfigures, or replays a token the way a browser could, and
 * verification must reject it with the documented reason.
 */

const NOW = 1_785_628_800_000;
const CONTEXT = {
  projectId: "proj_1",
  organizationId: "org_1",
  from: 1_785_542_400_000,
  to: 1_785_628_800_000,
  compareFrom: 1_785_456_000_000,
  compareTo: 1_785_542_400_000,
  asOf: 1_785_628_800_000,
  sourceIds: ["src_1", "src_2"],
};
const KEYS = { k1: "test-secret-key-one" };
const KEY = { kid: "k1", secret: KEYS.k1 };
const OPTIONS = {
  keys: KEYS,
  now: NOW,
  projectId: "proj_1",
  organizationId: "org_1",
  allowedSourceIds: ["src_1", "src_2", "src_3"],
};

/** Decode the payload segment WITHOUT verifying (attacker capability). */
const decodePayload = (token: string): Record<string, unknown> => {
  const [segment] = token.split(".");
  const json = Buffer.from(segment ?? "", "base64url").toString("utf8");
  return JSON.parse(json) as Record<string, unknown>;
};

const reencodePayload = (payload: Record<string, unknown>): string => {
  return Buffer.from(JSON.stringify(payload)).toString("base64url");
};

/** Manual HMAC for crafting defense-in-depth cases issuance would refuse. */
const manualSign = async (
  payload: Record<string, unknown>,
  secret: string,
): Promise<string> => {
  const segment = reencodePayload(payload);
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(segment),
  );
  const bytes = new Uint8Array(signature);
  return `${segment}.${Buffer.from(bytes).toString("base64url")}`;
};

describe("query context tokens", () => {
  it("round-trips a valid token with the bound context", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    expect(token).not.toContain("proj_1");
    const result = await verifyQueryContextToken(token, OPTIONS);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.context).toEqual({
        ...CONTEXT,
        timezone: "UTC",
        definitionVersion: 1,
      });
    }
  });

  it("validates signing keys at configuration time", () => {
    expect(() => validateTokenKeys({})).toThrow();
    expect(() => validateTokenKeys({ k1: "short" })).toThrow();
    expect(() =>
      validateTokenKeys({ ["__proto__"]: "x".repeat(32) }),
    ).not.toThrow();
    expect(() => validateTokenKeys(KEYS)).not.toThrow();
  });

  it("rejects a well-formed forged range (R1-F1 regression)", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    const [segment, signature] = token.split(".");
    // attacker decodes, widens the range, re-encodes valid JSON
    const forged = decodePayload(token);
    forged.from = 0;
    forged.to = 9_999_999_999_999;
    const forgedToken = `${reencodePayload(forged)}.${signature}`;
    expect(forgedToken.startsWith(`${segment}.`)).toBe(false);
    const result = await verifyQueryContextToken(forgedToken, OPTIONS);
    expect(result).toEqual({ ok: false, reason: "bad-signature" });
  });

  it("rejects forged asOf, source IDs, and scope the same way", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    const [, signature] = token.split(".");
    for (const mutate of [
      (payload: Record<string, unknown>) => {
        payload.asOf = 9_999_999_999_999;
      },
      (payload: Record<string, unknown>) => {
        payload.sourceIds = ["src_evil"];
      },
      (payload: Record<string, unknown>) => {
        payload.projectId = "proj_evil";
      },
      (payload: Record<string, unknown>) => {
        payload.organizationId = "org_evil";
      },
    ]) {
      const forged = decodePayload(token);
      mutate(forged);
      const result = await verifyQueryContextToken(
        `${reencodePayload(forged)}.${signature}`,
        OPTIONS,
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(["bad-signature", "scope-mismatch"]).toContain(result.reason);
      }
    }
  });

  it("rejects tampered signatures and wrong-key tokens", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    const [segment] = token.split(".");
    const tampered = await verifyQueryContextToken(
      `${segment}.${"A".repeat(43)}`,
      OPTIONS,
    );
    expect(tampered).toEqual({ ok: false, reason: "bad-signature" });
    const wrongKey = await verifyQueryContextToken(token, {
      ...OPTIONS,
      keys: { k1: "different-secret-xyz" },
    });
    expect(wrongKey).toEqual({ ok: false, reason: "bad-signature" });
    expect(await verifyQueryContextToken("", OPTIONS)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyQueryContextToken("no-dot-here", OPTIONS)).toEqual({
      ok: false,
      reason: "malformed",
    });
    expect(await verifyQueryContextToken("a.b.c", OPTIONS)).toEqual({
      ok: false,
      reason: "malformed",
    });
  });

  it("never resolves a __proto__ kid through the prototype chain", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    const forged = decodePayload(token);
    forged.kid = "__proto__";
    const [, signature] = token.split(".");
    const result = await verifyQueryContextToken(
      `${reencodePayload(forged)}.${signature}`,
      OPTIONS,
    );
    // own-property lookup misses; even a matching signature must not help
    expect(result).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("supports key rotation via kid, then drops retired keys", async () => {
    const oldKey = { kid: "k0", secret: "retiring-secret-000000" };
    const token = await issueQueryContextToken(CONTEXT, oldKey, NOW);
    const rotated = await verifyQueryContextToken(token, {
      ...OPTIONS,
      keys: { k1: KEYS.k1, k0: oldKey.secret },
    });
    expect(rotated.ok).toBe(true);
    const retired = await verifyQueryContextToken(token, OPTIONS);
    expect(retired).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("reports unknown token versions as version-mismatch, not malformed", async () => {
    const v2 = {
      ...decodePayload(await issueQueryContextToken(CONTEXT, KEY, NOW)),
      v: 2,
    };
    const token = await manualSign(v2, KEYS.k1);
    expect(await verifyQueryContextToken(token, OPTIONS)).toEqual({
      ok: false,
      reason: "version-mismatch",
    });
    const unversioned = { ...decodePayload(token) };
    delete unversioned.v;
    expect(
      await verifyQueryContextToken(
        await manualSign(unversioned, KEYS.k1),
        OPTIONS,
      ),
    ).toEqual({ ok: false, reason: "malformed" });
  });

  it("expires tokens after the TTL and validates the embedded lifetime", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    const justBefore = await verifyQueryContextToken(token, {
      ...OPTIONS,
      now: NOW + QUERY_CONTEXT_TOKEN_TTL_MS - 1,
    });
    expect(justBefore.ok).toBe(true);
    const expired = await verifyQueryContextToken(token, {
      ...OPTIONS,
      now: NOW + QUERY_CONTEXT_TOKEN_TTL_MS,
    });
    expect(expired).toEqual({ ok: false, reason: "expired" });
    // lifetime mismatch against the configured TTL
    const shortLived = await issueQueryContextToken(CONTEXT, KEY, NOW, {
      ttlMs: 1_000,
    });
    expect(await verifyQueryContextToken(shortLived, OPTIONS)).toEqual({
      ok: false,
      reason: "invalid-timestamps",
    });
  });

  it("rejects cross-project and cross-organization replay", async () => {
    const token = await issueQueryContextToken(CONTEXT, KEY, NOW);
    expect(
      await verifyQueryContextToken(token, { ...OPTIONS, projectId: "proj_2" }),
    ).toEqual({ ok: false, reason: "scope-mismatch" });
    expect(
      await verifyQueryContextToken(token, {
        ...OPTIONS,
        organizationId: "org_2",
      }),
    ).toEqual({ ok: false, reason: "scope-mismatch" });
  });

  it("requires the current source set: empty set allows sourceless tokens only", async () => {
    const token = await verifyQueryContextToken(
      await issueQueryContextToken(CONTEXT, KEY, NOW),
      { ...OPTIONS, allowedSourceIds: [] },
    );
    expect(token).toEqual({ ok: false, reason: "source-not-allowed" });
    const sourceless = await issueQueryContextToken(
      { ...CONTEXT, sourceIds: [] },
      KEY,
      NOW,
    );
    expect(
      await verifyQueryContextToken(sourceless, {
        ...OPTIONS,
        allowedSourceIds: [],
      }),
    ).toEqual({
      ok: true,
      context: expect.objectContaining({ sourceIds: [] }),
    });
    const stale = await verifyQueryContextToken(
      await issueQueryContextToken(CONTEXT, KEY, NOW),
      { ...OPTIONS, allowedSourceIds: ["src_1", "src_2"] },
    );
    expect(stale.ok).toBe(true);
    const archived = await verifyQueryContextToken(
      await issueQueryContextToken(CONTEXT, KEY, NOW),
      { ...OPTIONS, allowedSourceIds: ["src_1"] },
    );
    expect(archived).toEqual({ ok: false, reason: "source-not-allowed" });
  });

  it("refuses to issue nonsense ranges and rejects them on verify", async () => {
    await expect(
      issueQueryContextToken(
        { ...CONTEXT, from: CONTEXT.to, to: CONTEXT.from },
        KEY,
        NOW,
      ),
    ).rejects.toThrow(/range-invalid/);
    await expect(
      issueQueryContextToken(
        { ...CONTEXT, compareTo: CONTEXT.compareTo + 1 },
        KEY,
        NOW,
      ),
    ).rejects.toThrow(/range-invalid/);
    // same-length but non-adjacent comparison window
    const shifted = await manualSign(
      {
        ...decodePayload(await issueQueryContextToken(CONTEXT, KEY, NOW)),
        compareFrom: CONTEXT.compareFrom - 1_000,
        compareTo: CONTEXT.compareTo - 1_000,
      },
      KEYS.k1,
    );
    expect(await verifyQueryContextToken(shifted, OPTIONS)).toEqual({
      ok: false,
      reason: "range-invalid",
    });
  });

  it("rejects future asOf/issuedAt and duplicate source IDs", async () => {
    const semantics = {
      from: CONTEXT.from,
      to: CONTEXT.to,
      compareFrom: CONTEXT.compareFrom,
      compareTo: CONTEXT.compareTo,
      asOf: CONTEXT.asOf,
      issuedAt: NOW,
      now: NOW,
      sourceIds: CONTEXT.sourceIds,
      ttlMs: QUERY_CONTEXT_TOKEN_TTL_MS,
      clockSkewMs: QUERY_CONTEXT_TOKEN_CLOCK_SKEW_MS,
    };
    expect(validateQueryContextSemantics(semantics)).toEqual({ ok: true });
    expect(
      validateQueryContextSemantics({ ...semantics, asOf: NOW + 3_600_000 }),
    ).toEqual({ ok: false, reason: "invalid-timestamps" });
    expect(
      validateQueryContextSemantics({
        ...semantics,
        issuedAt: NOW + 3_600_000,
      }),
    ).toEqual({ ok: false, reason: "invalid-timestamps" });
    expect(
      validateQueryContextSemantics({
        ...semantics,
        sourceIds: ["src_1", "src_1"],
      }),
    ).toEqual({ ok: false, reason: "duplicate-sources" });
    await expect(
      issueQueryContextToken(
        { ...CONTEXT, sourceIds: ["src_1", "src_1"] },
        KEY,
        NOW,
      ),
    ).rejects.toThrow(/duplicate-sources/);
    // a duplicate smuggled past issuance still fails verification
    const duped = await manualSign(
      {
        ...decodePayload(await issueQueryContextToken(CONTEXT, KEY, NOW)),
        sourceIds: ["src_1", "src_1"],
      },
      KEYS.k1,
    );
    expect(await verifyQueryContextToken(duped, OPTIONS)).toEqual({
      ok: false,
      reason: "duplicate-sources",
    });
  });
});
