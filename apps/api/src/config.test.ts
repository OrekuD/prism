import { describe, expect, it } from "vitest";
import {
  resolveDeploymentMode,
  resolveEnvironment,
  resolvePrismConfig,
  resolveSignupPolicy,
  validateAllowedOrigins,
  validatePrismConfig,
} from "./config";

const base = {
  DATABASE_URL: "postgres://db",
  JWT_SECRET_KEY: "x".repeat(48),
  CLIENT_URL: "http://localhost:3001",
  BASE_URL: "http://localhost:8787",
};

describe("resolveDeploymentMode", () => {
  it("defaults to hosted", () => {
    expect(resolveDeploymentMode({})).toBe("hosted");
  });

  it("accepts self-hosted", () => {
    expect(resolveDeploymentMode({ PRISM_DEPLOYMENT_MODE: "self-hosted" })).toBe(
      "self-hosted",
    );
  });

  it("rejects unknown modes", () => {
    expect(() => resolveDeploymentMode({ PRISM_DEPLOYMENT_MODE: "cloud" })).toThrow(
      /PRISM_DEPLOYMENT_MODE/,
    );
  });
});

describe("resolveSignupPolicy", () => {
  it("defaults to open on hosted", () => {
    expect(resolveSignupPolicy({})).toBe("open");
  });

  it("defaults to disabled on self-hosted (secure default)", () => {
    expect(
      resolveSignupPolicy({ PRISM_DEPLOYMENT_MODE: "self-hosted" }),
    ).toBe("disabled");
  });

  it("prefers SIGNUP_POLICY over the legacy boolean", () => {
    expect(
      resolveSignupPolicy({ SIGNUP_POLICY: "invite-only", ALLOW_PUBLIC_SIGNUP: "true" }),
    ).toBe("invite-only");
  });

  it("maps the legacy ALLOW_PUBLIC_SIGNUP=false to disabled", () => {
    expect(resolveSignupPolicy({ ALLOW_PUBLIC_SIGNUP: "false" })).toBe("disabled");
  });

  it("rejects unknown policies", () => {
    expect(() => resolveSignupPolicy({ SIGNUP_POLICY: "everyone" })).toThrow(
      /SIGNUP_POLICY/,
    );
  });
});

describe("validatePrismConfig", () => {
  it("passes a complete configuration", () => {
    expect(validatePrismConfig(base)).toEqual([]);
  });

  it("names missing variables without leaking values", () => {
    const problems = validatePrismConfig({});
    expect(problems.join("\n")).toContain("DATABASE_URL is required");
    expect(problems.join("\n")).toContain("JWT_SECRET_KEY is required");
    expect(problems.join("\n")).toContain("CLIENT_URL is required");
    expect(problems.join("\n")).toContain("BASE_URL is required");
    // The secret VALUE must never appear in the messages.
    expect(problems.join("\n")).not.toContain("postgres://");
  });

  it("flags weak secrets with remediation", () => {
    const problems = validatePrismConfig({ ...base, JWT_SECRET_KEY: "short" });
    expect(problems.join("\n")).toContain("openssl rand -hex 32");
  });
});

describe("resolvePrismConfig", () => {
  it("resolves a full configuration", () => {
    const config = resolvePrismConfig(base);
    expect(config).toMatchObject({
      deploymentMode: "hosted",
      environment: "development",
      instanceName: "Prism",
      signupPolicy: "open",
    });
  });

  it("throws a combined message on invalid configuration", () => {
    expect(() => resolvePrismConfig({})).toThrow(/Prism configuration is invalid/);
  });

  it("uses the configured instance name", () => {
    expect(resolvePrismConfig({ ...base, INSTANCE_NAME: "Acme Analytics" }).instanceName).toBe(
      "Acme Analytics",
    );
  });
});

describe("resolveEnvironment", () => {
  it("defaults to development when missing", () => {
    expect(resolveEnvironment({})).toBe("development");
  });

  it("accepts production", () => {
    expect(resolveEnvironment({ ENVIRONMENT: "production" })).toBe("production");
  });

  it("normalizes case and whitespace", () => {
    expect(resolveEnvironment({ ENVIRONMENT: "  Production " })).toBe("production");
  });

  it("rejects misspellings and shorthand", () => {
    expect(() => resolveEnvironment({ ENVIRONMENT: "prod" })).toThrow(
      /ENVIRONMENT/,
    );
    expect(() => resolveEnvironment({ ENVIRONMENT: "staging" })).toThrow(
      /ENVIRONMENT/,
    );
  });
});

describe("validateAllowedOrigins", () => {
  it("accepts exact origins", () => {
    expect(
      validateAllowedOrigins({
        CORS_ALLOWED_ORIGINS: "https://app.example.com,http://localhost:3001",
      }),
    ).toEqual([]);
  });

  it("rejects subdomain wildcards too (exact origins only)", () => {
    const problems = validateAllowedOrigins({
      CORS_ALLOWED_ORIGINS: "https://*.sub.example.com",
    });
    expect(problems.join("\n")).toMatch(/wildcard/);
  });

  it("rejects bare wildcards", () => {
    const problems = validateAllowedOrigins({ CORS_ALLOWED_ORIGINS: "*" });
    expect(problems.join("\n")).toMatch(/CORS_ALLOWED_ORIGINS/);
  });

  it("rejects ? wildcards", () => {
    const problems = validateAllowedOrigins({
      CORS_ALLOWED_ORIGINS: "https://app?example.com",
    });
    expect(problems.join("\n")).toMatch(/wildcard/);
  });

  it("rejects paths, queries, and credentials", () => {
    const problems = validateAllowedOrigins({
      CORS_ALLOWED_ORIGINS:
        "https://app.example.com/path,https://app.example.com?q=1,https://user:pass@app.example.com",
    });
    expect(problems).toHaveLength(3);
  });

  it("rejects non-http schemes", () => {
    const problems = validateAllowedOrigins({
      CORS_ALLOWED_ORIGINS: "ftp://app.example.com",
    });
    expect(problems.join("\n")).toMatch(/http/);
  });

  it("rejects malformed entries", () => {
    const problems = validateAllowedOrigins({
      CORS_ALLOWED_ORIGINS: "not a url",
    });
    expect(problems).toHaveLength(1);
  });
});

describe("validatePrismConfig", () => {
  it("requires SETUP_TOKEN for every self-hosted deployment (dev too)", () => {
    for (const environment of ["development", "production"]) {
      const problems = validatePrismConfig({
        ...base,
        PRISM_DEPLOYMENT_MODE: "self-hosted",
        ENVIRONMENT: environment,
      });
      expect(problems.join("\n")).toMatch(/SETUP_TOKEN/);
    }
  });

  it("accepts self-hosted with a token", () => {
    const problems = validatePrismConfig({
      ...base,
      PRISM_DEPLOYMENT_MODE: "self-hosted",
      ENVIRONMENT: "development",
      SETUP_TOKEN: "x".repeat(24),
    });
    expect(problems).toEqual([]);
  });

  it("rejects short SETUP_TOKEN values", () => {
    const problems = validatePrismConfig({
      ...base,
      PRISM_DEPLOYMENT_MODE: "self-hosted",
      SETUP_TOKEN: "short",
    });
    expect(problems.join("\n")).toMatch(/SETUP_TOKEN is too short/);
  });

  it("does not require the token in hosted mode", () => {
    const problems = validatePrismConfig({
      ...base,
      PRISM_DEPLOYMENT_MODE: "hosted",
    });
    expect(problems).toEqual([]);
  });

  it("rejects malformed BASE_URL and CLIENT_URL", () => {
    const problems = validatePrismConfig({
      ...base,
      BASE_URL: "ftp://analytics.example.com",
      CLIENT_URL: "https://app.example.com/path",
    });
    expect(problems.join("\n")).toMatch(/BASE_URL/);
    expect(problems.join("\n")).toMatch(/CLIENT_URL/);
  });

  it("accepts origin-shaped BASE_URL and CLIENT_URL", () => {
    const problems = validatePrismConfig({
      ...base,
      BASE_URL: "https://analytics.example.com",
      CLIENT_URL: "https://app.example.com",
    });
    expect(problems).toEqual([]);
  });
});
