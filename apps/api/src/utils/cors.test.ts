import { describe, expect, it } from "vitest";
import type { Bindings } from "../types/types";
import { isOriginAllowed, resolveAllowedOrigins } from "./cors";

const devEnv = {
  CLIENT_URL: "http://localhost:5173",
  CORS_ALLOWED_ORIGINS: "https://app.prism.example.com, https://admin.example.com",
  ENVIRONMENT: "development",
} as Bindings;

const prodEnv = { ...devEnv, ENVIRONMENT: "production" } as Bindings;

describe("resolveAllowedOrigins", () => {
  it("combines CLIENT_URL with the comma-separated extra origins", () => {
    expect(resolveAllowedOrigins(devEnv)).toEqual([
      "http://localhost:5173",
      "https://app.prism.example.com",
      "https://admin.example.com",
    ]);
  });

  it("handles a trailing comma and empty values", () => {
    expect(
      resolveAllowedOrigins({
        CLIENT_URL: "http://localhost:5173",
        CORS_ALLOWED_ORIGINS: "http://localhost:5173,",
        ENVIRONMENT: "development",
      } as Bindings),
    ).toEqual(["http://localhost:5173"]);
  });

  it("falls back to an empty list when nothing is configured", () => {
    expect(resolveAllowedOrigins({} as Bindings)).toEqual([]);
  });
});

describe("isOriginAllowed", () => {
  it("allows explicit origins in any environment", () => {
    expect(isOriginAllowed("http://localhost:5173", prodEnv)).toBe(true);
    expect(isOriginAllowed("https://app.prism.example.com", prodEnv)).toBe(true);
    expect(isOriginAllowed("https://admin.example.com", prodEnv)).toBe(true);
  });

  it("blocks unknown origins in production", () => {
    expect(isOriginAllowed("http://localhost:3002", prodEnv)).toBe(false);
    expect(isOriginAllowed("http://127.0.0.1:5173", prodEnv)).toBe(false);
    expect(isOriginAllowed("https://evil.example.com", prodEnv)).toBe(false);
  });

  it("allows any localhost port in development", () => {
    expect(isOriginAllowed("http://localhost:3002", devEnv)).toBe(true);
    expect(isOriginAllowed("http://127.0.0.1:5173", devEnv)).toBe(true);
    expect(isOriginAllowed("http://localhost:4173", devEnv)).toBe(true);
    expect(isOriginAllowed("https://localhost:5173", devEnv)).toBe(true);
  });

  it("still blocks non-local origins in development", () => {
    expect(isOriginAllowed("https://evil.example.com", devEnv)).toBe(false);
  });
});
