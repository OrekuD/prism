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

/**
 * Minimal query surface used by controllers. Both runtime drivers expose
 * the same two shapes:
 * - tagged-template SQL: `db`\`SELECT ...`` (all call sites)
 * - `db.query(sql, params)` with $n placeholders (teams invite bulk
 *   insert) — native on neon-http, provided via postgres-js `unsafe`.
 */
export type ProductQuery = {
  (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Array<Record<string, unknown>>>;
  query: (
    query: string,
    params?: Array<unknown>,
  ) => Promise<Array<Record<string, unknown>>>;
};

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
  // SSL is only forced for Neon-style URLs; local PostgreSQL needs none.
  const ssl = env.DATABASE_URL?.includes("neon.tech")
    ? { ssl: "require" }
    : undefined;
  const sql = postgres(env.DATABASE_URL as string, {
    max: 10,
    ...(ssl ? { ssl } : {}),
  });

  // postgres-js has no `.query(sql, params)` method; expose one over
  // `unsafe` (parameters stay bound) so the shared ProductQuery surface
  // behaves identically on both drivers.
  const rawSql = sql as unknown as {
    (strings: TemplateStringsArray, ...values: unknown[]): Promise<unknown>;
    unsafe: (text: string, params: Array<unknown>) => Promise<unknown>;
  };
  const query = ((
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => rawSql(strings, ...values)) as unknown as ProductQuery;
  query.query = (async (sqlText: string, params?: Array<unknown>) =>
    rawSql.unsafe(sqlText, params ?? [])) as ProductQuery["query"];

  return {
    query,
    drizzle: drizzlePostgres(sql) as unknown as ProductDrizzle,
  };
}
