import { Client, createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

class TursoDatabaseManager {
  public instance: Client;

  constructor() {
    this.instance = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN!,
    });
  }
}

export default new TursoDatabaseManager();
