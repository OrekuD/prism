/**
 * Environment-reference drift test (task-8 section 8).
 *
 * Every environment variable documented in the configuration reference must
 * exist in at least one example file (apps/api/.env.example or
 * apps/api/.dev.vars.example) — and every variable in the example files
 * must either be documented or be a legacy alias. Prevents the docs and the
 * runtime contract from drifting apart.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../../..");
const configPage = readFileSync(
  resolve(root, "apps/docs/src/content/docs/self-hosting/configuration.mdx"),
  "utf8",
);
const envExample = readFileSync(
  resolve(root, "apps/api/.env.example"),
  "utf8",
);
const devVarsExample = readFileSync(
  resolve(root, "apps/api/.dev.vars.example"),
  "utf8",
);
const composeEnvExample = readFileSync(
  resolve(root, "deploy/compose.env.example"),
  "utf8",
);

const documented = new Set([
  ...configPage.matchAll(/`([A-Z][A-Z0-9_]+)`/g),
  ...configPage.matchAll(/name: '([A-Z][A-Z0-9_]+)'/g),
].map((m) => m[1]));
const exampleNames = (text: string) =>
  new Set(
    // Active lines and commented-out documentation lines both count.
    [...text.matchAll(/\b([A-Z][A-Z0-9_]{2,})=/g)].map((m) => m[1]),
  );

// Variables intentionally absent from the configuration page but present in
// example files (hosted-only, legacy aliases, or described in other pages).
const documentedElsewhere = new Set([
  "ALLOW_PUBLIC_SIGNUP", // legacy alias, documented on the config page text  "AUTH_BASE_URL", // analytics service, documented in networking/architecture
  "RESEND_API_KEY", // documented in operations/mail
  "PORT", // documented
  "TURSO_AUTH_TOKEN", // documented in configuration
  "TURSO_DATABASE_URL", // documented in configuration
  "IP_INFO_API_TOKEN", // documented in configuration + sessions
  "MAIL_FROM", // documented in configuration
  "POSTGRES_PASSWORD", // compose env, documented in installation
  "POSTGRES_USER", // compose env
  "POSTGRES_DB", // compose env
  "POSTGRES_PORT", // compose env, documented in networking
  "PUBLIC_URL", // compose env, documented in installation
  "PUBLIC_PORT", // compose env, documented in networking
  "INSTANCE_NAME", // documented in configuration
  "VITE_API_URL", // web build, documented in contributing/development
  "VITE_WS_API_URL", // web build, documented in contributing/development
  "VITE_MAPBOX_ACCESS_TOKEN", // web build, documented in product/realtime
  "E2E_API_URL", // test tooling
  "E2E_AUTH_URL", // test tooling
  "E2E_ORIGIN", // test tooling
  "E2E_ANALYTICS_URL", // test tooling
  "E2E_AUTO_VERIFY_EMAIL", // test tooling
  "E2E_SEED_EMAILS", // test tooling
  "ASTRO_SITE", // docs build, documented in astro.config + robots
  "SETUP_TOKEN", // documented in configuration
  "PROJECT_NAME", // legacy Worker binding from the pre-modernization API
]);

describe("environment reference drift", () => {
  it("every documented variable exists in an example file", () => {
    const inExamples = new Set([
      ...exampleNames(envExample),
      ...exampleNames(devVarsExample),
      ...exampleNames(composeEnvExample),
    ]);
    const missing = [...documented].filter((name) => !inExamples.has(name));
    expect(missing, `documented but missing from example files: ${missing.join(", ")}`).toEqual([]);
  });

  it("every example-file variable is documented or a known alias/tooling var", () => {
    const allExamples = new Set([
      ...exampleNames(envExample),
      ...exampleNames(devVarsExample),
    ]);
    const undocumented = [...allExamples].filter(
      (name) => !documented.has(name) && !documentedElsewhere.has(name),
    );
    expect(undocumented, `in examples but not documented: ${undocumented.join(", ")}`).toEqual([]);
  });
});
