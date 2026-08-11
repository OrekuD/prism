// src/database/migrate.ts
import { config } from "dotenv";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
config();
config({ path: ".dev.vars", override: false });
var ssl = process.env.DATABASE_URL?.includes("neon.tech") ? { ssl: "require" } : void 0;
var db = drizzlePostgres(
  postgres(process.env.DATABASE_URL, {
    max: 1,
    ...ssl ? { ssl } : {}
  })
);
var main = async () => {
  await migrate(db, { migrationsFolder: "drizzle" });
  process.exit(0);
};
main().catch((error) => {
  console.error("[prism-migrate] Failed:", error);
  process.exit(1);
});
