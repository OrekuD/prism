import { beforeEach, describe, expect, it, vi } from "vitest";
import Server, { authRateLimiter } from "../Server";
import type { Bindings } from "../types/types";

const ENV = {
  CLIENT_URL: "http://localhost:3001",
  CORS_ALLOWED_ORIGINS: "https://dashboard.prism.example",
  DATABASE_URL: "",
  JWT_SECRET_KEY: "test",
} as unknown as Bindings;

function preflight(origin: string) {
  return Server.getInstance().request(
    "/api/auth/sign-in/email",
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

    // The Better Auth handler needs a real database; the rate limiter runs
    // first, so every attempt is counted before the handler is reached.
    const attempt = () =>
      Server.getInstance().request(
        "/api/auth/sign-in/email",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ email: "a@b.c", password: "x" }),
        },
        ENV,
      );

    const statuses: Array<number> = [];
    for (let i = 0; i < 21; i += 1) {
      statuses.push((await attempt()).status);
    }

    const blocked = statuses[statuses.length - 1];
    expect(statuses.slice(0, 20).every((s) => s !== 429)).toBe(true);
    expect(blocked).toBe(429);

    const retry = await attempt();
    expect(Number(retry.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
