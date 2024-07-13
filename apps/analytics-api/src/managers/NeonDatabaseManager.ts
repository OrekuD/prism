import postgres from "postgres";
import dotenv from "dotenv";

dotenv.config();

class DatabaseManager {
  public instance: postgres.Sql<{}>;

  constructor() {
    let { PGHOST, PGDATABASE, PGUSER, PGPASSWORD, ENDPOINT_ID } = process.env;

    this.instance = postgres({
      host: PGHOST,
      database: PGDATABASE,
      username: PGUSER,
      password: PGPASSWORD,
      port: 5432,
      ssl: "require",
      connection: {
        options: `project=${ENDPOINT_ID}`,
      },
    });
  }
}

export default new DatabaseManager();
