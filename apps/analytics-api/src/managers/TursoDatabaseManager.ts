import { type Client, createClient } from "@libsql/client";
import dotenv from "dotenv";

dotenv.config();

class TursoDatabaseManager {
  private _instance: Client | null = null;

  /** Lazily creates the Turso client so startup validation can run first. */
  public get instance(): Client {
    if (!this._instance) {
      this._instance = createClient({
        url: process.env.TURSO_DATABASE_URL ?? "",
        authToken: process.env.TURSO_AUTH_TOKEN ?? "",
      });
    }

    return this._instance;
  }
}

export default new TursoDatabaseManager();
