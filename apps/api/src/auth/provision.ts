/**
 * Idempotent provisioning of Prism product resources for a new user.
 *
 * Better Auth owns identity; Prism owns the product shape: a profile row and
 * a personal team per user. Both are created once, keyed by the Better Auth
 * user id, so retries (e.g. after a partial failure) never duplicate rows.
 */
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import { profiles } from "../database/schema/profiles";
import { teams } from "../database/schema/teams";

type ProvisionDb =
  | PostgresJsDatabase
  | NodePgDatabase
  | NeonDatabase<Record<string, never>>;

function splitName(name: string, email: string) {
  const parts = name.trim().split(/\s+/);
  return {
    first_name: parts[0] ?? email,
    last_name: parts.slice(1).join(" ") || "-",
  };
}

export async function provisionUserResources(
  db: ProvisionDb,
  user: { id: string; name: string; email: string },
): Promise<void> {
  const existingProfile = await db
    .select({ id: profiles.id })
    .from(profiles)
    .where(eq(profiles.user_id, user.id))
    .limit(1);

  if (existingProfile.length === 0) {
    const { first_name, last_name } = splitName(user.name, user.email);
    await db.insert(profiles).values({
      user_id: user.id,
      first_name,
      last_name,
    });
  }

  const existingTeam = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.owner_id, user.id), eq(teams.is_personal, true)))
    .limit(1);

  if (existingTeam.length === 0) {
    await db.insert(teams).values({
      owner_id: user.id,
      name: `${user.name}'s team`,
      is_personal: true,
    });
  }
}
