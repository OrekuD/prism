/**
 * Task 13: workspace client bindings built entirely on Better Auth's
 * Organization plugin client API. There is no Prism workspace persistence
 * or controller layer — the plugin's session state (active organization)
 * is the single source of truth for the switcher, and its endpoints own
 * membership, roles, and invitations.
 *
 * Better Auth 1.6.26 exposes four react hooks (list, active organization,
 * active member, active member role); every mutation is a plain client
 * method on `authClient.organization.*` and is wrapped here.
 */
import { authClient } from "./authClient";
import { useParams } from "react-router-dom";

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
  metadata?: Record<string, unknown> | null;
};

/** All workspaces the signed-in user belongs to. */
export function useWorkspaces() {
  return authClient.useListOrganizations();
}

/** The active workspace (persisted in the Better Auth session). */
export function useActiveWorkspace() {
  return authClient.useActiveOrganization();
}

/** The caller's member record in the active workspace. */
export function useActiveMember() {
  return authClient.useActiveMember();
}

export type WorkspaceMember = {
  id: string;
  userId: string;
  organizationId: string;
  role: "owner" | "admin" | "member";
  createdAt: Date;
};

export type WorkspaceInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: "owner" | "admin" | "member" | null;
  status: "pending" | "accepted" | "rejected" | "canceled";
  expiresAt: Date;
  inviterId: string;
};

export const workspaceActions = {
  list: () => authClient.organization.list(),
  setActive: (organizationId: string) =>
    authClient.organization.setActive({ organizationId }),
  create: (name: string) =>
    authClient.organization.create({ name, slug: newWorkspaceSlug() }),
  update: (data: { organizationId: string; name: string }) =>
    authClient.organization.update({
      organizationId: data.organizationId,
      data: { name: data.name },
    }),
  delete: (organizationId: string) =>
    authClient.organization.delete({ organizationId }),
  leave: (organizationId: string) =>
    authClient.organization.leave({ organizationId }),
  listMembers: (organizationId: string) =>
    authClient.organization.listMembers({
      query: { organizationId },
    }),
  inviteMember: (data: {
    organizationId: string;
    email: string;
    role: "owner" | "admin" | "member";
  }) => authClient.organization.inviteMember(data),
  updateMemberRole: (data: {
    memberId: string;
    role: "owner" | "admin" | "member";
    organizationId: string;
  }) =>
    authClient.organization.updateMemberRole({
      memberId: data.memberId,
      role: data.role,
      organizationId: data.organizationId,
    }),
  removeMember: (data: { memberId: string; organizationId: string }) =>
    authClient.organization.removeMember({
      memberIdOrEmail: data.memberId,
      organizationId: data.organizationId,
    }),
  listInvitations: (organizationId: string) =>
    authClient.organization.listInvitations({
      query: { organizationId },
    }),
  listUserInvitations: () => authClient.organization.listUserInvitations(),
  acceptInvitation: (invitationId: string) =>
    authClient.organization.acceptInvitation({ invitationId }),
  cancelInvitation: (invitationId: string) =>
    authClient.organization.cancelInvitation({ invitationId }),
};

/**
 * Resolves the workspace the UI should treat as current: the session's
 * active organization when set, otherwise the first membership. The
 * switcher calls setActiveWorkspace to persist the choice.
 */
export function useCurrentWorkspace(): {
  workspace: Workspace | null;
  isLoading: boolean;
} {
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces();
  const { data: active, isPending: activePending } = useActiveWorkspace();
  return {
    workspace:
      ((active as Workspace | null) ??
        ((workspaces?.[0] as Workspace | undefined) ?? null)),
    isLoading: workspacesPending || activePending,
  };
}

/** F1/F3: URL-resolved workspace — the route slug + org list, not the
 * refetching activeOrganization. The shell renders this immediately; the
 * session's activeOrganizationId is only the persisted preference. */
export function useSelectedWorkspace(): {
  workspace: Workspace | null;
  isPending: boolean;
} {
  const { wrkSlug } = useParams();
  const { data: workspaces, isPending } = useWorkspaces();
  const list = (workspaces ?? []) as Workspace[];
  const workspace = wrkSlug ? (list.find((w) => w.slug === wrkSlug) ?? null) : null;
  return { workspace, isPending };
}

// F2: single-flight coordinator for setActive — dedup by target id.
const pendingSetActive = new Set<string>();
export async function setActiveOnce(organizationId: string): Promise<void> {
  if (pendingSetActive.has(organizationId)) return;
  pendingSetActive.add(organizationId);
  try {
    await workspaceActions.setActive(organizationId);
  } finally {
    pendingSetActive.delete(organizationId);
  }
}

/**
 * Workspace slugs are opaque, URL-safe identifiers in the form
 * `wrk_xxxxxxxxxxxxxxxx` (16 lowercase alphanumerics). They're designed to be
 * used in the workspace-scoped URL so the selected workspace is explicit
 * in the address bar.
 */
const WORKSPACE_SLUG_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
export function newWorkspaceSlug(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let slug = "wrk_";
  for (const byte of bytes) {
    slug += WORKSPACE_SLUG_ALPHABET[byte % WORKSPACE_SLUG_ALPHABET.length];
  }
  return slug;
}

/**
 * The default post-sign-in destination — the active (or first) workspace's
 * overview, e.g. `/wrk_xxxxx/overview`. This lets sign-in navigate straight
 * to the scoped dashboard URL instead of landing on a blank vanity path.
 * Falls back to `/overview` (which redirects) if no workspace has
 * provisioned yet. Best-effort: the auth session cookie is already set by
 * the caller (after waitForSession).
 */
export async function resolveDefaultWorkspacePath(): Promise<string> {
  try {
    const [{ data }, sessionData] = await Promise.all([
      authClient.organization.list(),
      authClient.getSession(),
    ]);
    const activeId = (
      sessionData as unknown as {
        session?: { activeOrganizationId?: string };
      } | null
    )?.session?.activeOrganizationId;
    const orgs = (data ?? []) as Array<{ id: string; slug: string }>;
    const target = orgs.find((o) => o.id === activeId) ?? orgs[0];
    return target?.slug ? `/workspace/${target.slug}/overview` : "/overview";
  } catch {
    return "/overview";
  }
}

export const WORKSPACE_PLATFORMS = [ // all known; create dialog filters to CREATABLE
  "web",
  "ios",
  "android",
  "react-native",
  "server",
] as const;

export type WorkspacePlatform = (typeof WORKSPACE_PLATFORMS)[number];
