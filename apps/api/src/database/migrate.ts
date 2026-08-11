import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";

// .env first (self-hosted Node operators), then .dev.vars (local wrangler
// dev). Shell variables are never overridden.
config();
config({ path: ".dev.vars", override: false });

// SSL is only forced for Neon-style URLs; plain local PostgreSQL (the
// self-hosted default) connects without it. No Neon-only query options.
const ssl = process.env.DATABASE_URL?.includes("neon.tech")
  ? { ssl: "require" }
  : undefined;
const db = drizzlePostgres(
  postgres(process.env.DATABASE_URL as string, {
    max: 1,
    ...(ssl ? { ssl } : {}),
  }),
);

const main = async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  process.exit(0);
};
main().catch((error) => {
  console.error("[prism-migrate] Failed:", error);
  process.exit(1);
});
