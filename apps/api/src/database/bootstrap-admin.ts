/**
 * First-owner bootstrap for a self-hosted instance (task-6 section 4).
 *
 * Creates the initial owner account (email/password), promotes it to ADMIN,
 * and provisions the profile + personal team. The bootstrap path is
 * permanently closed once ANY user exists: on a non-empty database the
 * script refuses to run unless BOOTSTRAP_FORCE=1 is set explicitly.
 *
 * Usage (from apps/api, on an EMPTY database):
 *   ADMIN_EMAIL=owner@example.com ADMIN_PASSWORD='<long-random-password>' \
 *     yarn tsx src/database/bootstrap-admin.ts
 *
 * After the owner exists, close registration with SIGNUP_POLICY=disabled
 * (or the legacy ALLOW_PUBLIC_SIGNUP=false).
 */
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import { config } from "dotenv";
import * as authSchema from "../database/schema/auth";
import { user as userTable } from "../database/schema/auth";
import { buildAuthOptions } from "../auth/options";
import { provisionUserResources } from "../auth/provision";
import { Roles } from "@prism/types";

config({ path: ".dev.vars" });

const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;

if (!email || !password) {
  console.error(
    "[bootstrap-admin] Set ADMIN_EMAIL and ADMIN_PASSWORD (never commit them).",
  );
  process.exit(1);
}

if (password.length < 8) {
  console.error("[bootstrap-admin] Password must be at least 8 characters.");
  process.exit(1);
}

const url = `${process.env.DATABASE_URL}?options=project%3D${process.env.PROJECT_NAME ?? "prism"}`;
const sql = postgres(url, { ssl: "require", max: 1 });
const db = drizzle(sql);

async function main() {
  const adminEmail = (email ?? "").toLowerCase().trim();
  const userCount = await db
    .select({ id: userTable.id })
    .from(userTable)
    .limit(1);

  if (userCount.length > 0 && process.env.BOOTSTRAP_FORCE !== "1") {
    console.error(
      "[bootstrap-admin] Refusing to bootstrap: the database already has users. " +
        "The first-owner bootstrap is only allowed on an empty database. " +
        "Set BOOTSTRAP_FORCE=1 only if you know what you are doing.",
    );
    process.exit(1);
  }

  const existing = await db
    .select({ id: userTable.id })
    .from(userTable)
    .where(eq(userTable.email, adminEmail))
    .limit(1);

  if (existing.length > 0) {
    console.log("[bootstrap-admin] An account with this email already exists.");
    process.exit(0);
  }

  const auth = betterAuth({
    ...buildAuthOptions(process.env as Record<string, string>, db as never),
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
    // Running the local bootstrap command with instance/database access is the
    // ownership proof. Without this, the verified-email product guards would
    // prevent the first self-hosted administrator from creating a project.
    .set({ role: Roles.ADMIN, emailVerified: true })
    .where(eq(userTable.id, response.user.id));

  await provisionUserResources(db, {
    id: response.user.id,
    name: response.user.name,
    email: response.user.email,
  });

  console.log(`[bootstrap-admin] Admin created: ${response.user.id}`);
  process.exit(0);
}

main().catch((error) => {
  console.error("[bootstrap-admin] Failed:", error);
  process.exit(1);
});
