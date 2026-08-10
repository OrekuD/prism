import { createClient, type Client } from "@libsql/client/web";
import type { HonoConfig } from "../types/types";
import type { Context } from "hono";

export class TursoDatabaseManager {
  private static instance: Client;

  public static getInstance(ctx: Context<HonoConfig>) {
    if (!TursoDatabaseManager.instance) {
      TursoDatabaseManager.instance = createClient({
        url: ctx.env.TURSO_DATABASE_URL,
        authToken: ctx.env.TURSO_AUTH_TOKEN,
      });
    }

    return TursoDatabaseManager.instance;
  }
}
