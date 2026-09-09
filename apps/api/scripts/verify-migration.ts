import { config } from "dotenv";
config();
config({ path: ".dev.vars", override: false });
import postgres from "postgres";

async function main() {
  const sql = postgres(process.env.DATABASE_URL as string, { max: 1 });

  const col = await sql`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'user' AND column_name = 'signup_workspace_name'
  `;
  console.log("signup_workspace_name present:", col.length > 0);

  const applied = await sql`
    SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 3
  `.catch(() => []);
  console.log(
    "drizzle migrations (latest):",
    applied.map((m) => String(m.hash).slice(0, 24)),
  );

  await sql.end();
  process.exit(0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
