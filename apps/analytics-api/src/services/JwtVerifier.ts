import { createRemoteJWKSet, jwtVerify, type JWTPayload } from "jose";

export const JWT_ISSUER = "prism";
export const JWT_AUDIENCE = "prism-analytics";

/**
 * Verifies short-lived service JWTs issued by the Better Auth JWT plugin.
 *
 * The public keys are fetched from the main API's JWKS endpoint and cached
 * by `createRemoteJWKSet` (keys are looked up by `kid`, so key rotation with
 * the plugin's grace period is handled automatically).
 *
 * Security/latency tradeoff (documented): verification is JWT-only — there is
 * no per-request session-table lookup, so a revoked session stays usable
 * until the token expires (default 15 minutes). Immediate revocation would
 * require a database session check per subscription and is a documented
 * follow-up.
 */
export class JwtVerifier {
  private static jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private static jwksUrl: string | null = null;

  public static getJwks(jwksUrl: string) {
    if (!JwtVerifier.jwks || JwtVerifier.jwksUrl !== jwksUrl) {
      JwtVerifier.jwksUrl = jwksUrl;
      JwtVerifier.jwks = createRemoteJWKSet(new URL(jwksUrl));
    }
    return JwtVerifier.jwks;
  }

  public static resetForTests() {
    JwtVerifier.jwks = null;
    JwtVerifier.jwksUrl = null;
  }

  /**
   * @returns the verified payload (subject = user id), or null when the
   * token is invalid, expired, wrong-issuer, wrong-audience, or signed by an
   * unknown key.
   */
  public static async verify(
    token: string,
    jwksUrl: string,
  ): Promise<JWTPayload | null> {
    try {
      const { payload } = await jwtVerify(token, JwtVerifier.getJwks(jwksUrl), {
        issuer: JWT_ISSUER,
        audience: JWT_AUDIENCE,
      });
      return payload;
    } catch {
      return null;
    }
  }
}
