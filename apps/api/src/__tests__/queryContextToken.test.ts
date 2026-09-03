import { describe, expect, it } from "vitest";
import {
  issueQueryContextToken,
  QUERY_CONTEXT_TOKEN_TTL_MS,
  verifyQueryContextToken,
} from "../utils/queryContextToken";

/**
 * Task 21 R1-F1 — server-only snapshot tokens. The shared types package
 * exposes only the opaque string shape; issuance and verification live here
 * with a server-held HMAC key. Every case below forges, tampers, or replays
 * a token the way a browser could, and verification must reject it.
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
      keys: { k1: "different-secret" },
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

  it("supports key rotation via kid, then drops retired keys", async () => {
    const oldKey = { kid: "k0", secret: "retiring-secret" };
    const token = await issueQueryContextToken(CONTEXT, oldKey, NOW);
    const rotated = await verifyQueryContextToken(token, {
      ...OPTIONS,
      keys: { k1: KEYS.k1, k0: oldKey.secret },
    });
    expect(rotated.ok).toBe(true);
    const retired = await verifyQueryContextToken(token, OPTIONS);
    expect(retired).toEqual({ ok: false, reason: "unknown-key" });
  });

  it("expires tokens after the TTL", async () => {
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

  it("rejects sources outside the project's current source set", async () => {
    const token = await issueQueryContextToken(
      { ...CONTEXT, sourceIds: ["src_1", "src_archived"] },
      KEY,
      NOW,
    );
    const result = await verifyQueryContextToken(token, {
      ...OPTIONS,
      allowedSourceIds: ["src_1", "src_2"],
    });
    expect(result).toEqual({ ok: false, reason: "source-not-allowed" });
  });

  it("rejects even validly-signed nonsense ranges (defense in depth)", async () => {
    // A signer bug (or leaked key used blindly) must not produce an
    // accepted inverted or unequal-length window.
    const inverted = await issueQueryContextToken(
      { ...CONTEXT, from: CONTEXT.to, to: CONTEXT.from },
      KEY,
      NOW,
    );
    expect(await verifyQueryContextToken(inverted, OPTIONS)).toEqual({
      ok: false,
      reason: "range-invalid",
    });
    const unequal = await issueQueryContextToken(
      { ...CONTEXT, compareTo: CONTEXT.compareTo + 1 },
      KEY,
      NOW,
    );
    expect(await verifyQueryContextToken(unequal, OPTIONS)).toEqual({
      ok: false,
      reason: "range-invalid",
    });
  });
});
