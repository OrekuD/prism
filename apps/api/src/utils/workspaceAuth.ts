/**
 * Task 13: single server-side product-action mapping for workspace
 * authorization. Every project decision derives the project's Better Auth
 * organization and proves membership against the plugin's canonical
 * `member` table — never a client-supplied organization ID, and never the
 * legacy team tables.
 *
 * Product matrix (mirrors task-13.md):
 *   - Read workspace/project analytics: owner, admin, member
 *   - Create, rename, or delete projects: owner, admin
 *   - Create, revoke, or reveal project keys: owner, admin
 *   - Invite/remove members, change roles: Better Auth client APIs
 *     (plugin policy; admins subject to owner-only safeguards)
 *   - Delete workspace / transfer ownership: Better Auth plugin policy
 *     (owner only)
 */
import type { Context } from "hono";
import type { HonoConfig } from "../types/types";
import { DatabaseManager } from "../managers/DatabaseManager";

export type WorkspaceRole = "owner" | "admin" | "member";

/** Better Auth's canonical roles (default plugin role model). */
const ADMIN_ROLES = new Set<WorkspaceRole>(["owner", "admin"]);

export function isAdminRole(role: WorkspaceRole | null): boolean {
  return role !== null && ADMIN_ROLES.has(role);
}

/**
 * Reads the caller's role in the organization from the canonical `member`
 * table. Returns null for a non-member. Never trusts the client.
 */
export async function getWorkspaceRole(
  ctx: Context<HonoConfig>,
  userId: string,
  organizationId: string,
): Promise<WorkspaceRole | null> {
  const db = DatabaseManager.getInstance(ctx);
  const rows = (await db`
    SELECT role FROM member
    WHERE user_id = ${userId} AND organization_id = ${organizationId}
    LIMIT 1`) as Array<{ role?: unknown }>;
  const role = rows[0]?.role;
  if (
    role === "owner" ||
    role === "admin" ||
    role === "member"
  ) {
    return role;
  }
  return null;
}

/** Resolves a project to its organization, or null when it does not exist. */
export async function getProjectOrganization(
  ctx: Context<HonoConfig>,
  projectId: string,
): Promise<string | null> {
  const db = DatabaseManager.getInstance(ctx);
  const rows = (await db`
    SELECT organization_id FROM projects WHERE id = ${projectId} LIMIT 1`) as Array<{
    organization_id?: unknown;
  }>;
  return rows[0]?.organization_id ? String(rows[0].organization_id) : null;
}

/**
 * The caller's role for a project's organization, or null when the project
 * is missing or the caller is not a member (both non-disclosing).
 */
export async function getProjectRole(
  ctx: Context<HonoConfig>,
  userId: string,
  projectId: string,
): Promise<WorkspaceRole | null> {
  const organizationId = await getProjectOrganization(ctx, projectId);
  if (!organizationId) return null;
  return getWorkspaceRole(ctx, userId, organizationId);
}

/**
 * True when the caller may perform restricted project actions (create /
 * rename / delete projects, manage keys): owner or admin.
 */
export async function isWorkspaceAdmin(
  ctx: Context<HonoConfig>,
  userId: string,
  organizationId: string,
): Promise<boolean> {
  const role = await getWorkspaceRole(ctx, userId, organizationId);
  return isAdminRole(role);
}
