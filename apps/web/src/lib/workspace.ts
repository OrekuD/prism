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

export type Workspace = {
  id: string;
  name: string;
  slug: string;
  logo: string | null;
  createdAt: Date;
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
    authClient.organization.create({ name, slug: `ws-${crypto.randomUUID()}` }),
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

export const WORKSPACE_PLATFORMS = [
  "web",
  "ios",
  "android",
  "react-native",
  "server",
] as const;

export type WorkspacePlatform = (typeof WORKSPACE_PLATFORMS)[number];
