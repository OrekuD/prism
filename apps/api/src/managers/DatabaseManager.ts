import { type NeonQueryFunction, neon } from "@neondatabase/serverless";
import type { HonoConfig } from "../types/types";
import type { Context } from "hono";

export class DatabaseManager {
  private static instance: NeonQueryFunction<false, false>;

  public static getInstance(ctx: Context<HonoConfig>) {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = neon(ctx.env.DATABASE_URL, { arrayMode: false });
    }

    return DatabaseManager.instance;
  }
}
