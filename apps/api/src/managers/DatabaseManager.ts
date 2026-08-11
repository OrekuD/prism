import { createProductDb } from "../database/db";
import type { ProductQuery } from "../database/db";
import type { HonoConfig } from "../types/types";
import type { Context } from "hono";

/**
 * Product database access for tagged-template queries (health checks,
 * runtime config, setup). The driver comes from the registered runtime
 * adapter — neon-http on the Cloudflare Worker, postgres-js on Node — so
 * plain PostgreSQL and Neon both work with the same code.
 */
export class DatabaseManager {
  private static instance: ProductQuery | null = null;

  public static getInstance(ctx: Context<HonoConfig>): ProductQuery {
    if (!DatabaseManager.instance) {
      DatabaseManager.instance = createProductDb(
        ctx.env as unknown as Record<string, string | undefined>,
      ).query;
    }

    return DatabaseManager.instance;
  }
}
