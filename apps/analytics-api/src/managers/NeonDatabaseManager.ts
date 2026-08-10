import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

class DatabaseManager {
  private _instance: postgres.Sql<Record<string, never>> | null = null;

  /** Lazily creates the Neon client so startup validation can run first. */
  public get instance(): postgres.Sql<Record<string, never>> {
    if (!this._instance) {
      const {
        NEONDB_PGHOST,
        NEONDB_PGDATABASE,
        NEONDB_PGUSER,
        NEONDB_PGPASSWORD,
        NEONDB_ENDPOINT_ID,
      } = process.env;

      this._instance = postgres({
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

    return this._instance;
  }
}

export default new DatabaseManager();
