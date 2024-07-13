import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

class DatabaseManager {
  public instance: postgres.Sql<{}>;

  constructor() {
    let {
      NEONDB_PGHOST,
      NEONDB_PGDATABASE,
      NEONDB_PGUSER,
      NEONDB_PGPASSWORD,
      NEONDB_ENDPOINT_ID,
    } = process.env;

    this.instance = postgres({
      host: NEONDB_PGHOST,
      database: NEONDB_PGDATABASE,
      username: NEONDB_PGUSER,
      password: NEONDB_PGPASSWORD,
      port: 5432,
      ssl: "require",
      connection: {
        options: `project=${NEONDB_ENDPOINT_ID}`,
      },
    });
  }
}

export default new DatabaseManager();
