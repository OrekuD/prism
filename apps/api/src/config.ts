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
export type StorageDriverName = "imagekit" | "s3" | "local";

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
  const raw = env.ENVIRONMENT?.trim().toLowerCase();
  if (raw === undefined || raw === "") {
    // Missing: development default (local defaults). This is only safe
    // because production deployments are expected to set it explicitly;
    // invalid values fail fast below instead of silently degrading
    // security (secure cookies, trusted origins, mail-link logging).
    return "development";
  }
  if (raw === "production" || raw === "development") {
    return raw;
  }
  throw new Error(
    "ENVIRONMENT must be 'development' or 'production' (got an unrecognized value; 'prod' is not accepted). Fix ENVIRONMENT.",
  );
}

/**
 * Origin allowlist validation. Entries are handed to Better Auth, whose
 * matcher treats `*` and `?` as wildcards, so origins must be EXACT:
 * `https://app.example.com`. No wildcards of any kind, no paths,
 * queries, fragments, credentials, or non-http(s) schemes.
 */
export function validateAllowedOrigins(
  env: Record<string, string | undefined>,
): string[] {
  const problems: string[] = [];
  const entries = (env.CORS_ALLOWED_ORIGINS ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  for (const entry of entries) {
    if (entry.includes("?") || entry.includes("*")) {
      problems.push(
        `CORS_ALLOWED_ORIGINS entry "${entry}" contains a wildcard, which is not allowed. Use exact origins (e.g. https://app.example.com).`,
      );
      continue;
    }
    try {
      const url = new URL(entry);
      const scheme = url.protocol;
      if (scheme !== "http:" && scheme !== "https:") {
        problems.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must use http or https.`,
        );
        continue;
      }
      if (url.pathname !== "/" || url.search || url.hash || url.username || url.password) {
        problems.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must be an origin without a path, query, fragment, or credentials.`,
        );
        continue;
      }
      const host = url.hostname;
      if (!host) {
        problems.push(
          `CORS_ALLOWED_ORIGINS entry "${entry}" must name a host.`,
        );
      }
    } catch {
      problems.push(
        `CORS_ALLOWED_ORIGINS entry "${entry}" is not a valid origin. Use the form https://app.example.com.`,
      );
    }
  }

  return problems;
}

/**
 * Registration policy. `SIGNUP_POLICY` is the canonical setting; the legacy
 * boolean `ALLOW_PUBLIC_SIGNUP` still maps when the new variable is absent.
 * Secure default: hosted instances default to open registration, self-hosted
 * instances to disabled until the operator opens them.
 */
/**
 * Object storage driver. Hosted defaults to imagekit (the Worker has no
 * filesystem and S3 signing is a self-hosted concern); self-hosted
 * defaults to `local` (files on disk, served by the API) and supports
 * `s3` (any S3-compatible endpoint) and `imagekit`.
 */
export function resolveStorageDriver(
  env: Record<string, string | undefined>,
): StorageDriverName {
  const raw = env.STORAGE_DRIVER?.trim().toLowerCase() as
    | StorageDriverName
    | undefined;
  if (raw && !["imagekit", "s3", "local"].includes(raw)) {
    throw new Error(
      "STORAGE_DRIVER must be 'imagekit', 's3', or 'local'. Fix STORAGE_DRIVER.",
    );
  }
  return raw ?? (resolveDeploymentMode(env) === "hosted" ? "imagekit" : "local");
}

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
 * Origin-shaped URL validation for BASE_URL / CLIENT_URL: absolute
 * http(s), no path, query, fragment, or credentials.
 */
function validateOriginUrl(
  variable: string,
  value: string | undefined,
): string[] {
  if (!value) return [];
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return [
        `${variable} must use http or https. Fix ${variable}.`,
      ];
    }
    if (
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.username ||
      url.password ||
      !url.hostname
    ) {
      return [
        `${variable} must be an origin without a path, query, fragment, or credentials (e.g. https://analytics.example.com). Fix ${variable}.`,
      ];
    }
  } catch {
    return [
      `${variable} is not a valid URL. Use the form https://analytics.example.com. Fix ${variable}.`,
    ];
  }
  return [];
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
  problems.push(...validateOriginUrl("BASE_URL", env.BASE_URL));
  problems.push(...validateOriginUrl("CLIENT_URL", env.CLIENT_URL));

  try {
    resolveDeploymentMode(env);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid PRISM_DEPLOYMENT_MODE.");
  }

  try {
    resolveEnvironment(env);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid ENVIRONMENT.");
  }

  try {
    resolveSignupPolicy(env);
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid SIGNUP_POLICY.");
  }

  try {
    const driver = resolveStorageDriver(env);
    if (driver !== "imagekit" && resolveDeploymentMode(env) === "hosted") {
      problems.push(
        "Hosted deployments use STORAGE_DRIVER=imagekit (the Worker has no filesystem and S3 signing is a self-hosted concern). Fix STORAGE_DRIVER.",
      );
    }
    if (driver === "s3") {
      for (const variable of [
        "STORAGE_S3_ENDPOINT",
        "STORAGE_S3_BUCKET",
        "STORAGE_S3_ACCESS_KEY_ID",
        "STORAGE_S3_SECRET_ACCESS_KEY",
        "STORAGE_PUBLIC_URL",
      ]) {
        if (!env[variable]) {
          problems.push(
            `${variable} is required when STORAGE_DRIVER=s3. Set ${variable}.`,
          );
        }
      }
      // The public object URL may carry a bucket prefix path (e.g.
      // https://minio.example.com/prism), so it is URL-validated, not
      // origin-validated.
      if (env.STORAGE_PUBLIC_URL) {
        try {
          const url = new URL(env.STORAGE_PUBLIC_URL);
          if (url.protocol !== "http:" && url.protocol !== "https:") {
            problems.push(
              "STORAGE_PUBLIC_URL must use http or https. Fix STORAGE_PUBLIC_URL.",
            );
          }
        } catch {
          problems.push(
            "STORAGE_PUBLIC_URL is not a valid URL (e.g. https://minio.example.com/prism). Fix STORAGE_PUBLIC_URL.",
          );
        }
      }
    }
    if (driver === "imagekit" && !env.IMAGE_KIT_API_KEY) {
      problems.push(
        "IMAGE_KIT_API_KEY is required when STORAGE_DRIVER=imagekit. Set IMAGE_KIT_API_KEY.",
      );
    }
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "Invalid STORAGE_DRIVER.");
  }

  problems.push(...validateAllowedOrigins(env));

  // First-owner setup must be token-protected on EVERY self-hosted
  // instance: the public endpoint would otherwise let anyone claim a
  // fresh instance (development included).
  if (resolveDeploymentMode(env) === "self-hosted") {
    const token = env.SETUP_TOKEN;
    if (!token) {
      problems.push(
        "SETUP_TOKEN is required for self-hosted deployments (the public first-owner setup endpoint must be token-protected). Generate one with: openssl rand -hex 24. Set SETUP_TOKEN.",
      );
    } else if (token.length < 16) {
      problems.push(
        "SETUP_TOKEN is too short (minimum 16 characters). Generate one with: openssl rand -hex 24.",
      );
    }
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
