import { createMiddleware } from "hono/factory";
import type { HonoConfig } from "../types/types";
import type { Context } from "hono";
import { Client, neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";

export const InjectDatabaseMiddleware = createMiddleware(
  async (ctx: Context<HonoConfig>, next) => {
    const client = new Client(ctx.env.DATABASE_URL);
    // await client.connect();
    ctx.set("client", client);
    ctx.set("db", drizzle(client));
    ctx.set("sql", neon(ctx.env.DATABASE_URL));
    await next();
  },
);
