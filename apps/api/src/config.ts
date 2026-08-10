/**
 * Central deployment configuration (task-6 sections 1-2, 4).
 *
 * `hosted` and `self-hosted` are explicit deployment modes over one shared
 * codebase; the difference is configuration and adapters, never a fork.
 *
 * Validation fails fast with variable NAMES and remediation steps, never
 * secret values. Optional integrations (Resend, ImageKit, IPinfo, Mapbox,
 * social providers) are not required here: they are validated by the flows
 * that use them.
 */

export type DeploymentMode = "hosted" | "self-hosted";
export type SignupPolicy = "open" | "invite-only" | "disabled";
export type Environment = "development" | "production";

export type PrismConfig = {
  deploymentMode: DeploymentMode;
  environment: Environment;
  instanceName: string;
  signupPolicy: SignupPolicy;
  /** Public URL of the API (Better Auth base URL, cookies, callbacks). */
  baseUrl: string;
  /** Dashboard origin (CORS allowlist, email links). */
  clientUrl: string;
};

const DEPLOYMENT_MODES = new Set<DeploymentMode>(["hosted", "self-hosted"]);
const SIGNUP_POLICIES = new Set<SignupPolicy>([
  "open",
  "invite-only",
  "disabled",
]);

export function resolveDeploymentMode(
  env: Record<string, string | undefined>,
): DeploymentMode {
  const mode = env.PRISM_DEPLOYMENT_MODE?.trim().toLowerCase() as
    | DeploymentMode
    | undefined;
  if (mode && !DEPLOYMENT_MODES.has(mode)) {
    throw new Error(
      "PRISM_DEPLOYMENT_MODE must be 'hosted' or 'self-hosted'. Fix PRISM_DEPLOYMENT_MODE.",
    );
  }
  return mode ?? "hosted";
}

export function resolveEnvironment(
  env: Record<string, string | undefined>,
): Environment {
  return env.ENVIRONMENT === "production" ? "production" : "development";
}

/**
 * Registration policy. `SIGNUP_POLICY` is the canonical setting; the legacy
 * boolean `ALLOW_PUBLIC_SIGNUP` still maps when the new variable is absent.
 * Secure default: hosted instances default to open registration, self-hosted
 * instances to disabled until the operator opens them.
 */
export function resolveSignupPolicy(
  env: Record<string, string | undefined>,
): SignupPolicy {
  const policy = env.SIGNUP_POLICY?.trim().toLowerCase() as
    | SignupPolicy
    | undefined;
  if (policy && !SIGNUP_POLICIES.has(policy)) {
    throw new Error(
      "SIGNUP_POLICY must be 'open', 'invite-only', or 'disabled'. Fix SIGNUP_POLICY.",
    );
  }
  if (policy) return policy;

  const legacy = env.ALLOW_PUBLIC_SIGNUP;
  if (legacy !== undefined && legacy !== "") {
    return legacy === "false" ? "disabled" : "open";
  }

  return resolveDeploymentMode(env) === "self-hosted" ? "disabled" : "open";
}

/**
 * Returns a list of configuration problems (variable names + remediation,
 * never values). An empty list means the configuration is usable.
 */
export function validatePrismConfig(
  env: Record<string, string | undefined>,
): string[] {
  const problems: string[] = [];

  const required = ["DATABASE_URL", "JWT_SECRET_KEY", "CLIENT_URL"];
  for (const variable of required) {
    if (!env[variable]) {
      problems.push(
        `${variable} is required. Copy apps/api/.dev.vars.example to apps/api/.dev.vars and fill it in.`,
      );
    }
  }

  const secret = env.JWT_SECRET_KEY ?? "";
  if (secret && secret.length < 32) {
    problems.push(
      "JWT_SECRET_KEY is too short (minimum 32 characters). Generate one with: openssl rand -hex 32",
    );
  }

  if (!env.BASE_URL) {
    problems.push(
      "BASE_URL is required (the public URL of this API; used for auth cookies, callbacks, and JWKS). Set BASE_URL.",
    );
  }

  try {
    resolveDeploymentMode(env);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid PRISM_DEPLOYMENT_MODE.");
  }

  try {
    resolveSignupPolicy(env);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid SIGNUP_POLICY.");
  }

  return problems;
}

/** Resolved configuration; throws with all problems when invalid. */
export function resolvePrismConfig(
  env: Record<string, string | undefined>,
): PrismConfig {
  const problems = validatePrismConfig(env);
  if (problems.length > 0) {
    throw new Error(
      `Prism configuration is invalid:\n${problems.map((p) => `  - ${p}`).join("\n")}`,
    );
  }
  return {
    deploymentMode: resolveDeploymentMode(env),
    environment: resolveEnvironment(env),
    instanceName: env.INSTANCE_NAME?.trim() || "Prism",
    signupPolicy: resolveSignupPolicy(env),
    baseUrl: env.BASE_URL as string,
    clientUrl: env.CLIENT_URL as string,
  };
}
