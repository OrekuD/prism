import { createClient, type Client } from "@libsql/client/web";
import { resolveDeploymentMode } from "../config";
import type { HonoConfig } from "../types/types";
import type { Context } from "hono";

/**
 * Analytics store (two-store architecture, task-6 ADR-0001). The product
 * API only READS from it (events, sessions); writes come from the
 * analytics service.
 *
 * The store is optional on SELF-HOSTED instances: without
 * TURSO_DATABASE_URL the reads return empty rows (no events recorded
 * yet) instead of failing, so a plain-PostgreSQL instance stays fully
 * usable and analytics light up once the operator adds the store. In
 * hosted mode the store is part of the stack, so a missing URL is a
 * misconfiguration and fails loudly.
 */
export class TursoDatabaseManager {
  private static instance: Client | null = null;
  private static warned = false;

  public static getInstance(ctx: Context<HonoConfig>): Client {
    if (TursoDatabaseManager.instance) {
      return TursoDatabaseManager.instance;
    }

    const url = ctx.env.TURSO_DATABASE_URL;
    if (!url) {
      if (resolveDeploymentMode(ctx.env) !== "self-hosted") {
        throw new Error(
          "TURSO_DATABASE_URL is required in hosted mode (analytics store). " +
            "Set TURSO_DATABASE_URL.",
        );
      }
      if (!TursoDatabaseManager.warned) {
        TursoDatabaseManager.warned = true;
        console.warn(
          "[prism-api] TURSO_DATABASE_URL is not set: analytics reads return empty. " +
            "Set it to enable events/sessions on this instance.",
        );
      }
      TursoDatabaseManager.instance = {
        execute: async () => ({ rows: [] }),
      } as unknown as Client;
      return TursoDatabaseManager.instance;
    }

    TursoDatabaseManager.instance = createClient({
      url,
      authToken: ctx.env.TURSO_AUTH_TOKEN,
    });
    return TursoDatabaseManager.instance;
  }
}
