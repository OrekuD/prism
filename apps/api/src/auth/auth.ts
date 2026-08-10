/**
 * Better Auth runtime instance for the Cloudflare Worker.
 *
 * A single instance per isolate, bound to the product Postgres database via
 * the neon-http driver (HTTP — no TCP required on Workers).
 */
import { betterAuth, type BetterAuthOptions, type Auth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as authSchema from "../database/schema/auth";
import { buildAuthOptions } from "./options";
import type { Bindings } from "../types/types";

let cached: Auth | null = null;

export function getAuth(env: Bindings): Auth {
  if (!cached) {
    const client = neon(env.DATABASE_URL);
    const db = drizzle(client);
    cached = betterAuth({
      ...buildAuthOptions(
        env as unknown as Record<string, string | undefined>,
        db as never,
      ),
      database: drizzleAdapter(db, { provider: "pg", schema: authSchema }),
    }) as Auth;
  }
  return cached;
}

export function resetAuthForTests() {
  cached = null;
}
