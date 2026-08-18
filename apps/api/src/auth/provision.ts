/**
 * Idempotent provisioning of Prism product resources for a new user.
 *
 * Better Auth owns identity AND workspaces (Task 13): each new user receives
 * one personal organization (owner role) through Better Auth's server API —
 * never direct inserts into the plugin's tables. Prism owns only the product
 * shape: a profile row per user. Both are created once, keyed by the Better
 * Auth user id, so retries (e.g. after a partial failure) never duplicate
 * rows.
 */
import { and, eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import type { PostgresJsDatabase } from "drizzle-orm/postgres-js";
import type { NeonDatabase } from "drizzle-orm/neon-serverless";
import type { GenericEndpointContext } from "better-auth";
import { profiles } from "../database/schema/profiles";
import { member } from "../database/schema/auth";

type ProvisionDb =
  | PostgresJsDatabase
  | NodePgDatabase
  | NeonDatabase<Record<string, never>>;

type AuthLike = { api: { createOrganization: (args: { body: { name: string; slug: string; userId: string } }) => Promise<unknown> } };

function splitName(name: string, email: string) {
  const parts = name.trim().split(/\s+/);
  return {
    first_name: parts[0] ?? email,
    last_name: parts.slice(1).join(" ") || "-",
  };
}

/**
 * Creates the user's personal workspace through Better Auth's supported
 * server API. `createOrganization` with a `userId` body is a documented
 * system action: it does not require a session and derives the owner from
 * the user id (creatorRole: "owner").
 *
 * In 1.6.26 the user.create hook context does not expose the auth API, so
 * the signup hook cannot provision the workspace itself; the API's
 * authentication middleware provisions lazily on the first authenticated
 * request instead (also a server-API path, no session needed).
 */

/** Opaque, URL-safe workspace slugs: `wrk_` + 16 lowercase alphanumerics. */
const WORKSPACE_SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function newWorkspaceSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let slug = "wrk_";
  for (const byte of bytes) {
    slug += WORKSPACE_SLUG_ALPHABET[byte % WORKSPACE_SLUG_ALPHABET.length];
  }
  return slug;
}

export async function createPersonalWorkspace(
  api: AuthLike["api"],
  user: { id: string; name: string },
): Promise<void> {
  try {
    await api.createOrganization({
      body: {
        name: `${user.name}'s workspace`,
        slug: newWorkspaceSlug(),
        userId: user.id,
      },
    });
  } catch (error) {
    // A concurrent first request may have created it already — the member
    // check raced. ALREADY_EXISTS is idempotent here.
    const message = String(
      (error as { message?: unknown })?.message ?? error,
    );
    if (message.includes("ALREADY_EXISTS")) return;
    throw error;
  }
}

// Per-isolate cache: users already confirmed to have a workspace skip the
// membership probe on every request. A user who deletes their last
// workspace and stays in the same isolate keeps the stale entry, which only
// means we stop auto-provisioning them — an explicit user action.
const provisionedUsers = new Set<string>();

export function resetProvisionedCacheForTests(): void {
  provisionedUsers.clear();
}

/**
 * Ensures the authenticated user has at least one workspace, creating the
 * personal owner workspace through the supported server API when they have
 * none. Reads only the canonical `member` table to check; never inserts
 * into Better Auth tables directly.
 */
export async function ensurePersonalWorkspace(
  db: ProvisionDb,
  auth: AuthLike,
  user: { id: string; name: string },
): Promise<void> {
  if (provisionedUsers.has(user.id)) return;

  const existing = await db
    .select({ organizationId: member.organizationId })
    .from(member)
    .where(eq(member.userId, user.id))
    .limit(1);

  if (existing.length > 0) {
    provisionedUsers.add(user.id);
    return;
  }

  await createPersonalWorkspace(auth.api, user);
  provisionedUsers.add(user.id);
}

export async function provisionUserResources(
  db: ProvisionDb,
  user: { id: string; name: string; email: string },
  _context?: GenericEndpointContext | null,
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
  // The personal workspace is provisioned lazily by the authentication
  // middleware (see ensurePersonalWorkspace) — the 1.6.26 hook context has
  // no server API handle.
}
