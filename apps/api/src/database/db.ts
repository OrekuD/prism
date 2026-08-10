/**
 * Product database access.
 *
 * Controllers and managers use DatabaseManager (tagged-template queries);
 * auth and provisioning use the drizzle instance. Both come from the
 * registered runtime adapter, so the same code runs on the Cloudflare
 * Worker (neon-http) and on Node (postgres-js).
 */
import { neon } from "@neondatabase/serverless";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-http";
import postgres from "postgres";
import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import { getRuntimeAdapter } from "../runtime";

/** Drizzle instance (runtime-specific driver); typed loosely at the seam. */
export type ProductDrizzle = {
  select: (table: unknown) => unknown;
  insert: (table: unknown) => unknown;
  execute: (query: unknown) => Promise<unknown>;
};

/** Minimal query surface used by controllers (tagged-template SQL). */
export type ProductQuery = (
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<Array<Record<string, unknown>>>;

export type ProductDb = {
  query: ProductQuery;
  drizzle: ProductDrizzle;
};

export function createProductDb(
  env: Record<string, string | undefined>,
): ProductDb {
  if (!env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is required. Copy apps/api/.dev.vars.example (Worker) or apps/api/.env.example (Node) and fill it in.",
    );
  }
  return getRuntimeAdapter().createProductDb(env) as ProductDb;
}

/** Neon adapter (Cloudflare Worker runtime). */
export function createNeonProductDb(
  env: Record<string, string | undefined>,
): ProductDb {
  const client = neon(env.DATABASE_URL as string, { arrayMode: false });
  return {
    query: client as unknown as ProductQuery,
    drizzle: drizzleNeon(client) as unknown as ProductDrizzle,
  } as ProductDb;
}

/** postgres-js adapter (Node runtime). */
export function createPostgresProductDb(
  env: Record<string, string | undefined>,
): ProductDb {
  const ssl = env.DATABASE_URL?.includes("neon.tech")
    ? { ssl: "require" }
    : undefined;
  const sql = postgres(env.DATABASE_URL as string, {
    max: 10,
    ...(ssl ? { ssl } : {}),
  });
  return {
    query: sql as unknown as ProductQuery,
    drizzle: drizzlePostgres(sql) as unknown as ProductDrizzle,
  };
}
