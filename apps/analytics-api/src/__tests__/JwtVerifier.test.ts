import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { exportJWK, generateKeyPair, SignJWT } from "jose";
import { JwtVerifier, JWT_AUDIENCE, JWT_ISSUER } from "../services/JwtVerifier.js";

const JWKS_URL = "http://auth.test/api/auth/jwks";

async function makeKeyPair() {
  const { publicKey, privateKey } = await generateKeyPair("RS256");
  const jwk = await exportJWK(publicKey);
  return {
    privateKey,
    jwks: { keys: [{ ...jwk, alg: "RS256", use: "sig", kid: "test-key-1" }] },
  };
}

function stubJwksFetch(jwks: unknown) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => jwks,
    })),
  );
}

function signWith(
  key: CryptoKey,
  claims: Record<string, unknown>,
  kid = "test-key-1",
) {
  return new SignJWT(claims)
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(JWT_ISSUER)
    .setAudience(JWT_AUDIENCE)
    .setSubject("11111111-1111-1111-1111-111111111111")
    .setIssuedAt()
    .setExpirationTime("5m")
    .sign(key);
}

describe("JwtVerifier (analytics service JWT contract)", () => {
  beforeEach(() => {
    JwtVerifier.resetForTests();
  });

  afterEach(() => {
    JwtVerifier.resetForTests();
    vi.unstubAllGlobals();
  });

  it("accepts a current token signed by the published key", async () => {
    const { privateKey, jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const token = await signWith(privateKey, {});

    const payload = await JwtVerifier.verify(token, JWKS_URL);

    expect(payload?.sub).toBe("11111111-1111-1111-1111-111111111111");
  });

  it("rejects an expired token", async () => {
    const { privateKey, jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(JWT_ISSUER)
      .setAudience(JWT_AUDIENCE)
      .setSubject("u1")
      .setIssuedAt()
      .setExpirationTime("-1m")
      .sign(privateKey);

    expect(await JwtVerifier.verify(token, JWKS_URL)).toBeNull();
  });

  it("rejects a token with the wrong issuer", async () => {
    const { privateKey, jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer("evil-issuer")
      .setAudience(JWT_AUDIENCE)
      .setSubject("u1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    expect(await JwtVerifier.verify(token, JWKS_URL)).toBeNull();
  });

  it("rejects a token with the wrong audience", async () => {
    const { privateKey, jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const token = await new SignJWT({})
      .setProtectedHeader({ alg: "RS256", kid: "test-key-1" })
      .setIssuer(JWT_ISSUER)
      .setAudience("some-other-service")
      .setSubject("u1")
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(privateKey);

    expect(await JwtVerifier.verify(token, JWKS_URL)).toBeNull();
  });

  it("rejects a token signed by an unknown key (not in the JWKS)", async () => {
    const { privateKey, jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const token = await signWith(privateKey, {}, "unknown-kid");

    expect(await JwtVerifier.verify(token, JWKS_URL)).toBeNull();
  });

  it("rejects a token signed by a completely different key pair", async () => {
    const { jwks } = await makeKeyPair();
    stubJwksFetch(jwks);
    const { privateKey: attackerKey } = await generateKeyPair("RS256");
    const token = await signWith(attackerKey, {});

    expect(await JwtVerifier.verify(token, JWKS_URL)).toBeNull();
  });

  it("rejects garbage input", async () => {
    stubJwksFetch({ keys: [] });
    expect(await JwtVerifier.verify("not-a-jwt", JWKS_URL)).toBeNull();
  });
});
