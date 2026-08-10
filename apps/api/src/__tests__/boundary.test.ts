import { beforeEach, describe, expect, it, vi } from "vitest";
import Server from "../Server";
import { authRateLimiter } from "../routers/AuthRouter";
import { inviteLimiter } from "../routers/TeamsRouter";
import type { Bindings } from "../types/types";

const ENV = {
  CLIENT_URL: "http://localhost:3001",
  CORS_ALLOWED_ORIGINS: "https://dashboard.prism.example",
  DATABASE_URL: "",
  JWT_SECRET_KEY: "test",
} as unknown as Bindings;

function preflight(origin: string) {
  return Server.getInstance().request(
    "/api/v1/auth/sign-in",
    {
      method: "OPTIONS",
      headers: {
        origin,
        "access-control-request-method": "POST",
      },
    },
    ENV,
  );
}

describe("main API boundary (CORS + rate limits)", () => {
  beforeEach(() => {
    authRateLimiter.reset();
    inviteLimiter.reset();
  });

  it("allows an approved dashboard origin", async () => {
    Server.startServer();
    const response = await preflight("http://localhost:3001");

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "http://localhost:3001",
    );
  });

  it("allows an extra origin from CORS_ALLOWED_ORIGINS", async () => {
    Server.startServer();
    const response = await preflight("https://dashboard.prism.example");

    expect(response.headers.get("access-control-allow-origin")).toBe(
      "https://dashboard.prism.example",
    );
  });

  it("rejects an unapproved browser origin", async () => {
    Server.startServer();
    const response = await preflight("https://evil.example");

    expect(response.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("serves non-browser requests without an Origin header", async () => {
    Server.startServer();
    const response = await Server.getInstance().request(
      "/",
      { method: "GET" },
      ENV,
    );

    expect(response.status).toBe(200);
  });

  it("returns 429 for auth endpoints past the rate limit", async () => {
    Server.startServer();
    const attempt = () =>
      Server.getInstance().request(
        "/api/v1/auth/sign-in",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "a@b.c", password: "x" }),
        },
        ENV,
      );

    // The GuestMiddleware rejects without a valid token; the limiter counts
    // the attempts before that. 10 allowed, then blocked.
    const statuses: Array<number> = [];
    for (let i = 0; i < 11; i += 1) {
      statuses.push((await attempt()).status);
    }

    const blocked = statuses[statuses.length - 1];
    expect(statuses.slice(0, 10).every((s) => s !== 429)).toBe(true);
    expect(blocked).toBe(429);

    const retry = await Server.getInstance().request(
      "/api/v1/auth/sign-in",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "a@b.c", password: "x" }),
      },
      ENV,
    );
    expect(Number(retry.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
