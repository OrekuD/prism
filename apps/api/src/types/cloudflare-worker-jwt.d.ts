/**
 * Ambient types for @tsndr/cloudflare-worker-jwt.
 *
 * The published v3 package does not ship its index.d.ts, so we declare the
 * subset of the API used by Prism here. Remove once upstream ships types.
 */
declare module "@tsndr/cloudflare-worker-jwt" {
  export type JWTAlgorithm =
    | "HS256"
    | "HS384"
    | "HS512"
    | "RS256"
    | "RS384"
    | "RS512"
    | "ES256"
    | "ES384"
    | "ES512";

  export function sign<T extends Record<string, unknown>>(
    payload: T,
    secret: string,
    options?: {
      algorithm?: JWTAlgorithm;
      exp?: number;
      nbf?: number;
      iat?: number;
    },
  ): Promise<string>;

  export function verify(
    token: string,
    secret: string,
    options?: { algorithm?: JWTAlgorithm },
  ): Promise<
    | false
    | {
        header: Record<string, unknown>;
        payload: Record<string, unknown>;
      }
  >;

  export function decode<T = Record<string, unknown>>(token: string): {
    header: Record<string, unknown>;
    payload: T;
  };

  export type JwtPayload = JWTPayload;

  export interface JWTPayload {
    [key: string]: unknown;
  }
}
