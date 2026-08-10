/**
 * Read-only schema inspection for the Prism product (Neon) and analytics
 * (Turso) databases.
 *
 * Run with: yarn workspace prism-api db:inspect
 *
 * Prints table/column/index inventory and row counts only — never connection
 * strings, passwords, or row data. Safe to run against any environment.
 */
import { config } from "dotenv";
import postgres from "postgres";
import { createClient } from "@libsql/client/web";

config({ path: ".dev.vars" });

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[db:inspect] Missing ${name} in apps/api/.dev.vars`);
    process.exit(1);
  }
  return value;
}

async function inspectNeon() {
  const url = `${required("DATABASE_URL")}?options=project%3D${process.env.PROJECT_NAME ?? "prism"}`;
  const sql = postgres(url, { ssl: "require", max: 1 });

  console.log("\n===== NEON (product database) =====");

  const tables = await sql`
    SELECT tablename
    FROM pg_tables
    WHERE schemaname = 'public'
    ORDER BY tablename`;

  for (const { tablename } of tables) {
    const count = await sql`SELECT count(*)::int AS n FROM ${sql(tablename)}`;
    console.log(`\n--- ${tablename} (${count[0].n} rows) ---`);

    const columns = await sql`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = ${tablename}
      ORDER BY ordinal_position`;
    for (const c of columns) {
      console.log(
        `  ${c.column_name}: ${c.data_type} nullable=${c.is_nullable} default=${c.column_default ?? "—"}`,
      );
    }

    const indexes = await sql`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = ${tablename}
      ORDER BY indexname`;
    for (const i of indexes) {
      const kind = i.indexdef.includes("UNIQUE") ? "UNIQUE" : "index";
      console.log(`  [${kind}] ${i.indexname}`);
    }
  }

  const migrations = await sql`
    SELECT schemaname, tablename FROM pg_tables
    WHERE tablename LIKE '%migration%'
    ORDER BY schemaname`;
  if (migrations.length > 0) {
    for (const m of migrations) {
      const n = await sql`SELECT count(*)::int AS n FROM ${sql(m.schemaname)}.${sql(m.tablename)}`;
      console.log(`\n[migrations] ${m.schemaname}.${m.tablename}: ${n[0].n} applied`);
    }
  } else {
    console.log("\n[migrations] no migrations table found");
  }

  await sql.end();
}

async function inspectTurso() {
  const url = required("TURSO_DATABASE_URL");
  const token = required("TURSO_AUTH_TOKEN");
  const client = createClient({ url, authToken: token });

  console.log("\n===== TURSO (analytics database) =====");

  const objects = await client.execute(
    "SELECT type, name, tbl_name FROM sqlite_master WHERE type IN ('table','index') AND name NOT LIKE 'sqlite_%' ORDER BY type, name",
  );
  console.log("\n--- objects ---");
  for (const row of objects.rows) {
    console.log(`  [${row.type}] ${row.name}${row.tbl_name ? ` (on ${row.tbl_name})` : ""}`);
  }

  const sessions = objects.rows.filter(
    (r) => r.type === "table" && r.name === "sessions",
  );
  if (sessions.length > 0) {
    const info = await client.execute("PRAGMA table_info(sessions)");
    console.log("\n--- sessions columns ---");
    for (const c of info.rows) {
      console.log(
        `  ${c.name}: ${c.type} notnull=${c.notnull} default=${c.dflt_value ?? "—"} pk=${c.pk}`,
      );
    }
    const count = await client.execute("SELECT count(*) AS n FROM sessions");
    console.log(`\n--- sessions rows: ${count.rows[0].n} ---`);
  }

  client.close();
}

async function main() {
  await inspectNeon();
  await inspectTurso();
  console.log("\nInspection complete.");
  process.exit(0);
}

main().catch((error) => {
  console.error("[db:inspect] failed:", error);
  process.exit(1);
});
