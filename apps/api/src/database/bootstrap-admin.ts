/**
 * First-owner bootstrap for a self-hosted instance (task-6 section 4).
 *
 * Creates the initial owner account (email/password), promotes it to ADMIN,
 * marks the email verified (the verified-email product guards would
 * otherwise block the first project), and provisions the profile + personal
 * team. The bootstrap path is permanently closed once ANY user exists: on a
 * non-empty database the script refuses to run unless BOOTSTRAP_FORCE=1 is
 * set explicitly.
 *
 * Running the command with database access IS the operator proof — no
 * network endpoint is involved.
 *
 * Usage (from apps/api, on an EMPTY database):
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='<long-random-password>' \
 *     yarn tsx src/database/bootstrap-admin.ts
 *
 * The script loads .env (Node self-hosted) then .dev.vars (local wrangler
 * dev); shell variables take precedence. The registration policy is
 * bypassed for the bootstrap request (the default self-hosted
 * SIGNUP_POLICY=disabled would otherwise reject the signup).
 *
 * After the owner exists, close registration with SIGNUP_POLICY=disabled
 * (or the legacy ALLOW_PUBLIC_SIGNUP=false).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { eq } from "drizzle-orm";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import { config as loadDotenv } from "dotenv";
import * as authSchema from "../database/schema/auth";
import { user as userTable } from "../database/schema/auth";
import { buildAuthOptions } from "../auth/options";
import { provisionUserResources } from "../auth/provision";
import { createPostgresProductDb } from "../database/db";
import { Roles } from "@prism-analytics/types";
import { logger } from "../utils/logger";

// .env first (self-hosted Node operators), then .dev.vars (local wrangler
// dev). Shell variables are never overridden.
loadDotenv();
loadDotenv({ path: ".dev.vars", override: false });

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  logger.error(
    "bootstrap-admin",
    "Set ADMIN_EMAIL and ADMIN_PASSWORD (never commit them).",
  );
  process.exit(1);
}

if (password.length < 8) {
  logger.error("bootstrap-admin", "Password must be at least 8 characters.");
  process.exit(1);
}

// The shared Node adapter owns connection settings (no forced SSL, no
// Neon-only query options); recover the concrete drizzle type here.
const { drizzle } = createPostgresProductDb(process.env);
const db = drizzle as unknown as PostgresJsDatabase;

async function main() {
  const adminEmail = (email ?? "").toLowerCase().trim();
  const userCount = await db
    .select({ id: userTable.id })
    .from(userTable)
    .limit(1);

  if (userCount.length > 0 && process.env.BOOTSTRAP_FORCE !== "1") {
    logger.error(
      "bootstrap-admin",
      "Refusing to bootstrap: the database already has users. The first-owner bootstrap is only allowed on an empty database. Set BOOTSTRAP_FORCE=1 only if you know what you are doing.",
    );
    process.exit(1);
  }

  const existing = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, adminEmail))
    .limit(1);

  if (existing.length > 0) {
    logger.info("bootstrap-admin", "An account with this email already exists.");
    process.exit(0);
  }

  const options = buildAuthOptions(
    process.env as Record<string, string>,
    db as never,
  );
  const auth = betterAuth({
    ...options,
    // The bootstrap bypasses the registration policy: the default
    // self-hosted SIGNUP_POLICY=disabled must not block the first owner.
    emailAndPassword: {
      ...options.emailAndPassword,
      enabled: true,
      disableSignUp: false,
    },
    database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
  });

  const response = await auth.api.signUpEmail({
    body: {
      email: adminEmail,
      password: password ?? "",
      name: "Prism Admin",
    },
  });

  await db
    .update(userTable)
    .set({ role: Roles.ADMIN, emailVerified: true })
    .where(eq(userTable.id, response.user.id));

  await provisionUserResources(db, {
    id: response.user.id,
    name: response.user.name,
    email: response.user.email,
  });

  logger.info("bootstrap-admin", "admin created", { userId: response.user.id });
  process.exit(0);
}

main().catch((error) => {
  logger.error("bootstrap-admin", "failed", {
    message: error instanceof Error ? error.message : error,
  });
  process.exit(1);
});
