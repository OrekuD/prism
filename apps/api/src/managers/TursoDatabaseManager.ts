import { createClient, Client } from "@libsql/client/web";
import { HonoConfig } from "../types/types";
import { Context } from "hono";

export class TursoDatabaseManager {
  private static instance: Client;

  public static getInstance(ctx: Context<HonoConfig>) {
    if (!this.instance) {
      this.instance = createClient({
        url: ctx.env.TURSO_DATABASE_URL,
        authToken: ctx.env.TURSO_AUTH_TOKEN,
      });
    }

    return this.instance;
  }
}
