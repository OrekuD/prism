import { config } from "dotenv";
import postgres from "postgres";

import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";

console.log({
  e: process.env.DATABASE_URL,
});

config({ path: ".dev.vars" });

const url = `${process.env.DATABASE_URL}?options=project%3D${process.env.PROJECT_NAME}`;
const db = drizzle(postgres(url, { ssl: "require", max: 1 }));
const main = async () => {
  try {
    await db.execute(sql`BEGIN`);

    const tables = await db.execute(sql`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public';
    `);

    tables.forEach(async (table) => {
      const tablename = table.tablename as string;
      await db.execute(
        sql`DROP TABLE IF EXISTS ${sql.identifier(tablename)} CASCADE`,
      );
    });

    await db.execute(sql`COMMIT`);
    console.log("Database tables dropped.");
    process.exit(0);
  } catch (error) {
    console.error(error);
    process.exit(1);
  }
};
main();
