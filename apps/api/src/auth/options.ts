/**
 * Shared Better Auth options for Prism.
 *
 * Used by:
 * - the Cloudflare Worker runtime (apps/api/src/auth/auth.ts)
 * - the Better Auth CLI for schema generation (apps/api/auth.config.ts)
 * - tests
 *
 * The database instance is injected so each runtime can use its own driver
 * (neon-http on the Worker, postgres-js for the CLI and Node tooling).
 */
import type { BetterAuthOptions, GenericEndpointContext } from "better-auth";
import { jwt, organization } from "better-auth/plugins";
import { logger } from "../utils/logger";
import { github, google } from "better-auth/social-providers";
import { provisionUserResources } from "./provision.js";
import { scheduleEmail } from "./mail.js";
import { resolveEnvironment, resolveSignupPolicy } from "../config";

export type AuthEnv = Record<string, string | undefined>;

export function isProduction(env: AuthEnv) {
  // Strict: invalid ENVIRONMENT values fail fast instead of silently
  // degrading to development (secure cookies, trusted origins).
  return resolveEnvironment(env) === "production";
}

export function buildAuthOptions(
  env: AuthEnv,
  db: {
    insert: (table: unknown) => unknown;
    select: (table: unknown) => unknown;
  },
): BetterAuthOptions {
  const production = isProduction(env);
  const baseURL = env.BASE_URL ?? "http://localhost:8787";
  const trustedOrigins = [
    env.CLIENT_URL ?? "http://localhost:5173",
    ...(env.CORS_ALLOWED_ORIGINS ?? "")
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    // Development: trust any localhost/127.0.0.1/portless host so dev servers on
    // any port work; production stays locked to the explicit allowlist.
    // better-auth's matchesOriginPattern treats "*" as a wildcard. Include
    // https for portless (https://prism.localhost, https://docs.prism.localhost).
    ...(env.ENVIRONMENT === "development"
      ? [
          "http://localhost:*",
          "http://127.0.0.1:*",
          "https://localhost:*",
          "https://127.0.0.1:*",
          "https://prism.localhost:*",
          "https://docs.prism.localhost:*",
          "https://prism.localhost",
          "https://docs.prism.localhost",
        ]
      : []),
  ].filter(Boolean);

  const githubEnabled = Boolean(
    env.GITHUB_CLIENT_ID && env.GITHUB_CLIENT_SECRET,
  );
  const googleEnabled = Boolean(
    env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET,
  );

  return {
    appName: "Prism",
    baseURL,
    secret: env.JWT_SECRET_KEY ?? "",
    trustedOrigins,
    advanced: {
      // UUID-compatible ids keep Better Auth users valid FK targets for the
      // existing product tables (profiles, teams, memberships, projects).
      // Use an application-side generator because Better Auth treats
      // PostgreSQL as natively UUID-capable when this is the string "uuid"
      // and then inserts DEFAULT. Prism intentionally stores Better Auth IDs
      // in text columns, which have no database UUID default.
      database: {
        generateId: () => crypto.randomUUID(),
      },
      useSecureCookies: production,
      defaultCookieAttributes: {
        httpOnly: true,
        sameSite:
          production &&
          (() => {
            try {
              return new URL(baseURL).origin !== new URL(env.CLIENT_URL ?? "").origin;
            } catch {
              return true;
            }
          })()
            ? "none"
            : "lax",
        secure: production,
      },
      cookiePrefix: "prism",
    },
    user: {
      additionalFields: {
        userName: {
          type: "string",
          required: false,
          input: true,
        },
        // Server-owned role: not writable through client or provider input.
        role: {
          type: "number",
          required: false,
          defaultValue: 1,
          input: false,
        },
      },
    },
    emailAndPassword: {
      enabled: true,
      // Registration policy: open | invite-only | disabled (SIGNUP_POLICY,
      // with legacy ALLOW_PUBLIC_SIGNUP mapping). invite-only and disabled
      // close public signup; invites and the first-owner bootstrap remain.
      disableSignUp: resolveSignupPolicy(env) !== "open",
      minPasswordLength: 8,
      sendResetPassword: async ({ user, url }) => {
        scheduleEmail(env, {
          to: user.email,
          subject: "Password Reset Request for Your Prism Account",
          template: "reset-password",
          props: { name: user.name, resetLink: url, instanceName: env.INSTANCE_NAME },
        });
      },
    },
    emailVerification: {
      // Product creation is guarded by email verification, so password
      // signups must receive the verification link immediately.
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => {
        scheduleEmail(env, {
          to: user.email,
          subject: "Confirm Email for your Prism Account",
          template: "confirm-email",
          props: { name: user.name, confirmEmailLink: url, instanceName: env.INSTANCE_NAME },
        });
      },
      autoSignInAfterVerification: true,
    },
    socialProviders: {
      ...(githubEnabled
        ? {
            github: github({
              clientId: env.GITHUB_CLIENT_ID ?? "",
              clientSecret: env.GITHUB_CLIENT_SECRET ?? "",
            }),
          }
        : {}),
      ...(googleEnabled
        ? {
            google: google({
              clientId: env.GOOGLE_CLIENT_ID ?? "",
              clientSecret: env.GOOGLE_CLIENT_SECRET ?? "",
            }),
          }
        : {}),
    } as BetterAuthOptions["socialProviders"],
    databaseHooks: {
      user: {
        create: {
          after: async (user, context) => {
            // Idempotent: retries cannot create duplicate profiles/teams.
            // Provisioning failure must not break signup; it is retried on
            // the next login via the idempotent check.
            try {
              await provisionUserResources(
                db as never,
                user as never,
                context as GenericEndpointContext | null,
              );
            } catch (error) {
              // Provisioning is part of the signup contract: under vitest
              // a failure must fail the test, not be swallowed.
              if (typeof process !== "undefined" && process.env.VITEST === "true") {
                throw error;
              }
              logger.warn("auth", "profile/workspace provisioning failed", {
                message: error instanceof Error ? error.message : error,
              });
            }
          },
        },
      },
    },
    plugins: [
      // Task 13: Better Auth Organizations are the SINGLE authority for Prism
      // workspaces — membership, roles, invitations, active workspace, and
      // profile metadata all live in the plugin's canonical tables.
      //
      // Default roles match the product matrix without an override: owner
      // (org update/delete, member+invite management), admin (org update,
      // member+invite management — never org delete), member (read-only).
      // Product actions (project create/rename/delete, key management) are
      // mapped from these roles server-side; no shadow permission_id system.
      //
      // The nested Teams plugin stays disabled: an Organization IS a Prism
      // workspace, and Prism has no nested workgroups.
      organization({
        allowUserToCreateOrganization: true,
        allowMultipleOrganizations: true,
        creatorRole: "owner",
        membershipLimit: 100,
      }),
      jwt({
        jwt: {
          issuer: "prism",
          audience: "prism-analytics",
        },
        jwks: {
          keyPairConfig: { alg: "RS256" },
          rotationInterval: 60 * 60 * 24 * 30, // 30 days
          gracePeriod: 60 * 60 * 24 * 7, // 7 days of overlap for rotation
        },
      }),
    ],
  };
}
