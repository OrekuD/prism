import { describe, expect, it } from "vitest";
import {
  resolveDeploymentMode,
  resolvePrismConfig,
  resolveSignupPolicy,
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
