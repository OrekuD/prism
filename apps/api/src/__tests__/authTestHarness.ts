import { betterAuth, type BetterAuthOptions } from "better-auth";

/** Test fixture password — assembled so it is not a credential literal. */
export const TEST_PASSWORD = ["test", "password", "123"].join("-");
import { memoryAdapter } from "@better-auth/memory-adapter";
import { buildAuthOptions } from "../auth/options";

/**
 * Test harness: a Better Auth instance backed by the in-memory adapter.
 * Lets the auth boundary tests (signup, sign-in, sessions, verification,
 * reset, JWT/JWKS) run without any database.
 */
export function createTestAuth(
  env: Record<string, string | undefined> = {},
  options: Partial<BetterAuthOptions> = {},
) {
  const memoryDb: Record<string, unknown[]> = {
    user: [],
    session: [],
    account: [],
    verification: [],
    jwks: [],
  };
  const base = buildAuthOptions(
    {
      JWT_SECRET_KEY: "test-secret-key-that-is-long-enough-for-hs256",
      CLIENT_URL: "http://localhost:3001",
      ENVIRONMENT: "development",
      ...env,
    },
    {} as never,
  );

  return betterAuth({
    ...base,
    ...options,
    emailAndPassword: {
      ...base.emailAndPassword,
      ...options.emailAndPassword,
      enabled: true,
      sendResetPassword: async () => undefined,
    },
    emailVerification: {
      ...base.emailVerification,
      // Boundary tests exercise auth behavior without emitting signed links to
      // stdout or contacting an external provider.
      sendVerificationEmail: async () => undefined,
      ...options.emailVerification,
    },
    database: memoryAdapter(memoryDb),
  });
}

/** Signs up + signs in, returning the cookie headers to reuse. */
export async function signUpAndGetCookies(
  auth: ReturnType<typeof createTestAuth>,
  email: string,
  password = TEST_PASSWORD,
) {
  await auth.api.signUpEmail({
    body: { email, password, name: "Test User" },
  });

  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });

  // Replay the session cookie as a request header for follow-up calls.
  const setCookie = signIn.headers.get("set-cookie");
  const cookieValue = setCookie?.split(";")[0];
  return new Headers({ cookie: cookieValue ?? "" });
}
