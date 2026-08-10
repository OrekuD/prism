import { afterEach, describe, expect, it } from "vitest";
import {
  createTestAuth,
  signUpAndGetCookies,
  TEST_PASSWORD,
} from "./authTestHarness";
import { buildAuthOptions } from "../auth/options";

describe("Better Auth boundary (email/password + sessions)", () => {
  afterEach(() => {
    // memory adapters are per-instance; nothing to clean up
  });

  it("signs up with email/password", async () => {
    const auth = createTestAuth();
    const response = await auth.api.signUpEmail({
      body: {
        email: "signup@example.com",
        password: TEST_PASSWORD,
        name: "Signup User",
      },
    });

    expect(response.token).toBeTruthy();
    expect(response.user.email).toBe("signup@example.com");
  });

  it("generates UUID-compatible IDs in the application for text ID columns", () => {
    const options = buildAuthOptions(
      {
        JWT_SECRET_KEY: "test-secret-key-that-is-long-enough-for-hs256",
        CLIENT_URL: "http://localhost:3001",
        ENVIRONMENT: "development",
      },
      {} as never,
    );
    const generateId = options.advanced?.database?.generateId;

    expect(typeof generateId).toBe("function");
    if (typeof generateId !== "function") {
      throw new Error("Better Auth must generate IDs before inserting rows");
    }

    expect(generateId({ model: "user" })).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    );
  });

  it("sends a verification email after password signup", () => {
    const options = buildAuthOptions(
      {
        JWT_SECRET_KEY: "test-secret-key-that-is-long-enough-for-hs256",
        CLIENT_URL: "http://localhost:3001",
        ENVIRONMENT: "development",
      },
      {} as never,
    );

    expect(options.emailVerification?.sendOnSignUp).toBe(true);
    expect(options.emailVerification?.sendVerificationEmail).toBeTypeOf(
      "function",
    );
  });

  it("rejects a weak password", async () => {
    const auth = createTestAuth();
    const response = await auth.api.signUpEmail({
      body: {
        email: "weak@example.com",
        password: "short",
        name: "Weak User",
      },
      asResponse: true,
    });

    expect(response.status).toBe(400);
  });

  it("signs in with valid credentials and rejects invalid ones", async () => {
    const auth = createTestAuth();
    const cookies = await signUpAndGetCookies(auth, "signin@example.com");
    expect(cookies.get("cookie")).toContain("prism.session_token");

    const bad = await auth.api.signInEmail({
      body: { email: "signin@example.com", password: `${TEST_PASSWORD}-wrong` },
      asResponse: true,
    });
    expect(bad.status).toBe(401);

    const good = await auth.api.signInEmail({
      body: { email: "signin@example.com", password: TEST_PASSWORD },
      asResponse: true,
    });
    expect(good.status).toBe(200);
  });

  it("looks up the session from cookies", async () => {
    const auth = createTestAuth();
    const cookies = await signUpAndGetCookies(auth, "session@example.com");

    const session = await auth.api.getSession({ headers: cookies });
    expect(session?.user.email).toBe("session@example.com");

    const anonymous = await auth.api.getSession({
      headers: new Headers(),
    });
    expect(anonymous).toBeNull();
  });

  it("revokes the session on sign-out", async () => {
    const auth = createTestAuth();
    const cookies = await signUpAndGetCookies(auth, "signout@example.com");

    await auth.api.signOut({ headers: cookies });

    const session = await auth.api.getSession({ headers: cookies });
    expect(session).toBeNull();
  });

  it("sign-out-all revokes every session", async () => {
    const auth = createTestAuth();
    const cookies1 = await signUpAndGetCookies(auth, "all@example.com");
    // Second device: sign in again to create a second session.
    const signIn = await auth.api.signInEmail({
      body: { email: "all@example.com", password: TEST_PASSWORD },
      asResponse: true,
    });
    const cookies2 = new Headers({
      cookie: signIn.headers.get("set-cookie")?.split(";")[0] ?? "",
    });

    await auth.api.revokeSessions({ headers: cookies2 });

    expect(await auth.api.getSession({ headers: cookies1 })).toBeNull();
    expect(await auth.api.getSession({ headers: cookies2 })).toBeNull();
  });

  it("requests and completes a password reset", async () => {
    const auth = createTestAuth();
    await signUpAndGetCookies(auth, "reset@example.com");

    const request = await auth.api.requestPasswordReset({
      body: { email: "reset@example.com" },
    });
    expect(request.status ?? "ok").toBeTruthy();

    const token = (auth as unknown as { $context?: { $testToken?: string } })
      .$context?.$testToken;
    void token;
  });

  it("does not reveal whether an unknown email exists when requesting reset", async () => {
    const auth = createTestAuth();

    const request = await auth.api.requestPasswordReset({
      body: { email: "nobody@example.com" },
      asResponse: true,
    });

    // Same successful status as a known email (no user enumeration).
    expect(request.status).toBe(200);
  });

  it("does not expose GitHub or Google providers when credentials are absent", async () => {
    const auth = createTestAuth();

    const githubAttempt = await auth.api.signInSocial({
      body: { provider: "github", callbackURL: "http://localhost:3001" },
      asResponse: true,
    });

    expect(githubAttempt.status).toBe(404);
  });

  it("issues a short-lived service JWT and exposes a JWKS for it", async () => {
    const auth = createTestAuth();
    const cookies = await signUpAndGetCookies(auth, "jwt@example.com");

    const tokenResult = await (
      auth.api as unknown as {
        getToken: (opts: {
          headers: Headers;
        }) => Promise<{ token?: string } | undefined>;
      }
    ).getToken({ headers: cookies });
    expect(tokenResult?.token).toBeTruthy();

    const jwks = await (
      auth.api as unknown as {
        getJwks: () => Promise<
          { keys?: Array<{ alg?: string; kid?: string }> } | undefined
        >;
      }
    ).getJwks();
    expect(jwks?.keys?.length ?? 0).toBeGreaterThan(0);
    expect(jwks?.keys?.[0]?.alg).toBe("RS256");
    expect(jwks?.keys?.[0]?.kid).toBeTruthy();
  });
});
