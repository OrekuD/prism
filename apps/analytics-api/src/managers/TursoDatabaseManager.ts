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

  /**
   * Test-only injection: points the singleton at an ISOLATED store (e.g. a
   * fully migrated libSQL :memory: database) for real-store controller
   * tests. Never call from production code paths.
   */
  public setInstanceForTests(client: Client): void {
    this._instance = client;
  }
}

export default new TursoDatabaseManager();
