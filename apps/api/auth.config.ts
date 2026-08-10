/**
 * Better Auth CLI configuration — schema generation only.
 *
 * Run from apps/api:
 *   npx @better-auth/cli generate --config auth.config.ts --output src/database/schema/auth.ts -y
 *
 * Uses postgres-js (Node) since the CLI cannot run inside the Worker.
 * The runtime instance (src/auth/auth.ts) uses the neon-http driver.
 */
import { betterAuth, type BetterAuthOptions } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { config } from "dotenv";
import { buildAuthOptions } from "./src/auth/options.js";

config({ path: ".dev.vars" });

const url = `${process.env.DATABASE_URL}?options=project%3D${process.env.PROJECT_NAME ?? "prism"}`;
const sql = postgres(url, { ssl: "require", max: 1 });
const db = drizzle(sql);

const base = buildAuthOptions(
  process.env as Record<string, string>,
  db as never,
);

export const auth = betterAuth({
  ...base,
  // drizzleAdapter returns a factory; Better Auth calls it with its options.
  // Merging our product schema lets the CLI diff against existing tables.
  database: (options: BetterAuthOptions & { schema?: Record<string, unknown> }) =>
    drizzleAdapter(db, {
      provider: "pg",
      schema: {
        ...((db as unknown as { _: { fullSchema: unknown } })._?.fullSchema ?? {}),
        ...options.schema,
      },
    })(options),
});
