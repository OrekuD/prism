import React from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  useActiveMember,
  useActiveWorkspace,
  workspaceActions,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from "@/lib/workspace";
import { getInitials } from "@/utils/getInitials";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { UserPlus, Trash2, LogOut } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

type MemberRow = WorkspaceMember & { user?: { name?: string; email?: string } };

/**
 * Members (v2 dashboard `team` view): a standalone workspace-level page in
 * the product shell — Better Auth owns membership, roles, and invitations.
 * The owner may not be removed by anyone (v2 keeps the first row action-free).
 */
export function MembersPage() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useActiveMember();
  const organizationId = (activeWorkspace as { id?: string } | null)?.id;
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;
  const myRole = (activeMember as { role?: string } | null)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const [members, setMembers] = React.useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = React.useState<WorkspaceInvitation[] | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const navigate = useNavigate();

  const load = React.useCallback(async () => {
    if (!organizationId) return;
    const [memberRows, inviteRows] = await Promise.all([
      workspaceActions.listMembers(organizationId),
      workspaceActions.listInvitations(organizationId),
    ]);
    setMembers((memberRows as unknown as MemberRow[] | null));
    setInvitations((inviteRows as unknown as WorkspaceInvitation[] | null));
  }, [organizationId]);

  React.useEffect(() => {
    setMembers(null);
    setInvitations(null);
    void load();
  }, [load]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      await load();
    } catch (error) {
      const message = String((error as { message?: unknown })?.message ?? error);
      toast.error(message.includes("YOU_ARE_NOT_ALLOWED") ? "You don't have permission to do that." : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Members</h1>
          <p className="page-sub">Members of the {workspaceName ?? "workspace"} workspace and their roles.</p>
        </div>
        {canManage ? (
          <button type="button" className="btn btn-primary" onClick={() => setInviteOpen(true)}>
            <UserPlus className="ic" />
            Invite member
          </button>
        ) : null}
      </div>

      <div className="sec-label">Members</div>
      <div className="tbl-wrap">
        <table className="tbl">
          <thead>
            <tr><th>Member</th><th>Role</th><th>Status</th><th>Last active</th><th style={{ textAlign: "right" }}>Actions</th></tr>
          </thead>
          <tbody>
            {members === null ? (
              <tr><td colSpan={5}><span className="skel" /></td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={5} className="muted">No members yet.</td></tr>
            ) : (
              members.map((member) => {
                const displayName = member.user?.name ?? member.userId;
                return (
                  <tr key={member.id}>
                    <td>
                      <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className="avatar" style={{ width: 24, height: 24, fontSize: 10 }} aria-hidden="true">
                          {getInitials(displayName)}
                        </span>
                        <span>
                          <span style={{ display: "block", fontSize: 13, fontWeight: 500 }}>{displayName}</span>
                          <span className="subtle" style={{ fontSize: 12 }}>{member.user?.email ?? member.userId}</span>
                        </span>
                      </span>
                    </td>
                    <td className="mono">
                      {canManage && member.role !== "owner" && organizationId ? (
                        <Select
                          value={member.role}
                          onValueChange={(role) =>
                            void run(
                              () =>
                                workspaceActions.updateMemberRole({
                                  memberId: member.id,
                                  role: role as "owner" | "admin" | "member",
                                  organizationId,
                                }),
                              "Role updated",
                            )
                          }
                        >
                          <SelectTrigger className="h-7 w-[110px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        ROLE_LABELS[member.role] ?? member.role
                      )}
                    </td>
                    <td><span className="tag ok">Active</span></td>
                    <td className="muted" style={{ fontSize: 12 }}>—</td>
                    <td>
                      <span className="tbl-actions">
                        {canManage && member.role !== "owner" && organizationId ? (
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm"
                            disabled={busy}
                            aria-label={`Remove ${displayName}`}
                            onClick={() =>
                              void run(
                                () => workspaceActions.removeMember({ memberId: member.id, organizationId }),
                                "Member removed",
                              )
                            }
                          >
                            <Trash2 className="ic ic-sm" />
                          </button>
                        ) : null}
                      </span>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {canManage ? (
        <>
          <div className="sec-label">Pending invitations</div>
          {invitations === null ? (
            <span className="skel" />
          ) : (invitations ?? []).filter((invite) => invite.status === "pending").length === 0 ? (
            <p className="muted" style={{ fontSize: 13 }}>No pending invitations.</p>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Expires</th><th style={{ textAlign: "right" }}>Actions</th></tr></thead>
                <tbody>
                  {(invitations ?? [])
                    .filter((invite) => invite.status === "pending")
                    .map((invite) => (
                      <tr key={invite.id}>
                        <td>{invite.email}</td>
                        <td className="mono">{ROLE_LABELS[invite.role ?? "member"] ?? invite.role}</td>
                        <td><span className="tag warn">Pending</span></td>
                        <td className="muted" style={{ fontSize: 12 }}>{new Date(invite.expiresAt).toLocaleDateString()}</td>
                        <td>
                          <span className="tbl-actions">
                            <button
                              type="button"
                              className="btn btn-ghost btn-sm"
                              disabled={busy}
                              onClick={() => void run(() => workspaceActions.cancelInvitation(invite.id), "Invitation cancelled")}
                            >
                              Cancel
                            </button>
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : null}

      {myRole === "owner" && organizationId ? (
        <div className="danger-zone">
          <div className="dz-t">Danger zone</div>
          <p>Leaving is the only self-service option for owners. Deleting the workspace is handled from workspace settings.</p>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={busy}
            onClick={() =>
              void run(
                async () => {
                  await workspaceActions.leave(organizationId);
                  navigate("/overview");
                },
                "Left workspace",
              )
            }
          >
            <LogOut className="ic" /> Leave workspace
          </button>
        </div>
      ) : null}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(email, role) => {
          if (!organizationId) return;
          void run(
            () =>
              workspaceActions.inviteMember({ organizationId, email, role: role as "owner" | "admin" | "member" }),
            `Invitation sent to ${email}`,
          );
        }}
      />
    </>
  );
}

function InviteDialog({
  open,
  onOpenChange,
  onInvited,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (email: string, role: string) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            They receive an email with a link to join the workspace. Invitations are managed by Better Auth and expire automatically.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!email.trim()) return;
            onInvited(email.trim(), role);
            setEmail("");
            onOpenChange(false);
          }}
        >
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="teammate@example.com" />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">Admins can manage keys, billing, and members.</p>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="btn btn-secondary">Cancel</button>
            </DialogClose>
            <button className="btn btn-primary" type="submit">Send invitation</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
