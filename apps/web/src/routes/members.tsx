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

const TH = "whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted";
const TD = "border-t border-border px-3.5 py-[11px] align-middle leading-[1.4]";

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
    const [memberResult, inviteResult] = await Promise.all([
      workspaceActions.listMembers(organizationId),
      workspaceActions.listInvitations(organizationId),
    ]);
    // Better Auth client methods resolve to { data, error }; listMembers
    // returns { data: { members }, } and listInvitations returns
    // { data: Invitation[] }. Extract the arrays before storing.
    const memberRows =
      (memberResult as { data?: { members?: MemberRow[] } })?.data
        ?.members ?? [];
    const inviteRows =
      (inviteResult as { data?: WorkspaceInvitation[] })?.data ?? [];
    setMembers(memberRows);
    setInvitations(inviteRows);
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
          <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">Members</h1>
          <p className="mt-2 text-sm text-text-muted">Members of the {workspaceName ?? "workspace"} workspace and their roles.</p>
        </div>
        {canManage ? (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-[2px] bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover"
          >
            <UserPlus className="size-4" />Invite member
          </button>
        ) : null}
      </div>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Members</div>
      <div className="overflow-auto rounded-[2px] border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr><th className={TH}>Member</th><th className={TH}>Role</th><th className={TH}>Status</th><th className={TH}>Last active</th><th className={`${TH} text-right`}>Actions</th></tr>
          </thead>
          <tbody>
            {members === null ? (
              <tr><td colSpan={5} className={TD}><span className="inline-block h-[14px] w-[72px] animate-pulse rounded-[2px] bg-surface-raised" /></td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={5} className={`${TD} text-text-muted`}>No members yet.</td></tr>
            ) : (
              members.map((member) => {
                const displayName = member.user?.name ?? member.userId;
                return (
                  <tr key={member.id} className="group transition-colors hover:bg-surface-hover">
                    <td className={TD}>
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] font-semibold text-text" aria-hidden="true">
                          {getInitials(displayName)}
                        </span>
                        <span>
                          <span className="block text-[13px] font-medium">{displayName}</span>
                          <span className="block text-[12px] text-text-subtle">{member.user?.email ?? member.userId}</span>
                        </span>
                      </span>
                    </td>
                    <td className={`${TD} font-mono`}>
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
                    <td className={TD}><span className="inline-flex h-[22px] items-center gap-1.5 rounded-[2px] border border-success/40 px-2 font-mono text-[11px] whitespace-nowrap text-success">Active</span></td>
                    <td className={`${TD} text-[12px] text-text-muted`}>—</td>
                    <td className={TD}>
                      <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        {canManage && member.role !== "owner" && organizationId ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Remove ${displayName}`}
                            onClick={() => void run(() => workspaceActions.removeMember({ memberId: member.id, organizationId }), "Member removed")}
                            className="inline-flex h-[30px] items-center gap-2 rounded-[2px] px-3 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
                          >
                            <Trash2 className="size-3.5" />
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
          <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Pending invitations</div>
          {invitations === null ? (
            <span className="inline-block h-[14px] w-[72px] animate-pulse rounded-[2px] bg-surface-raised" />
          ) : (invitations ?? []).filter((invite) => invite.status === "pending").length === 0 ? (
            <p className="text-[13px] text-text-muted">No pending invitations.</p>
          ) : (
            <div className="overflow-auto rounded-[2px] border border-border">
              <table className="w-full border-collapse text-[13px]">
                <thead><tr><th className={TH}>Email</th><th className={TH}>Role</th><th className={TH}>Status</th><th className={TH}>Expires</th><th className={`${TH} text-right`}>Actions</th></tr></thead>
                <tbody>
                  {(invitations ?? [])
                    .filter((invite) => invite.status === "pending")
                    .map((invite) => (
                      <tr key={invite.id} className="group">
                        <td className={TD}>{invite.email}</td>
                        <td className={`${TD} font-mono`}>{ROLE_LABELS[invite.role ?? "member"] ?? invite.role}</td>
                        <td className={TD}><span className="inline-flex h-[22px] items-center gap-1.5 rounded-[2px] border border-warning/40 px-2 font-mono text-[11px] whitespace-nowrap text-warning">Pending</span></td>
                        <td className={`${TD} text-[12px] text-text-muted`}>{new Date(invite.expiresAt).toLocaleDateString()}</td>
                        <td className={TD}>
                          <span className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100">
                            <button
                              type="button"
                              disabled={busy}
                              onClick={() => void run(() => workspaceActions.cancelInvitation(invite.id), "Invitation cancelled")}
                              className="inline-flex h-[30px] items-center gap-2 rounded-[2px] px-3 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
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
        <div className="mt-5 border-t border-danger pt-5">
          <div className="mb-1.5 text-[13px] font-semibold text-danger">Danger zone</div>
          <p className="mb-3.5 text-[13px] leading-relaxed text-text-muted">Leaving is the only self-service option for owners. Deleting the workspace is handled from workspace settings.</p>
          <button
            type="button"
            disabled={busy}
            onClick={() => void run(async () => { await workspaceActions.leave(organizationId); navigate("/overview"); }, "Left workspace")}
            className="inline-flex h-9 items-center gap-2 rounded-[2px] border border-border-strong px-3.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
          >
            <LogOut className="size-4" /> Leave workspace
          </button>
        </div>
      ) : null}

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(email, role) => {
          if (!organizationId) return;
          void run(
            () => workspaceActions.inviteMember({ organizationId, email, role: role as "owner" | "admin" | "member" }),
            `Invitation sent to ${email}`,
          );
        }}
      />
    </>
  );
}

function InviteDialog({ open, onOpenChange, onInvited }: { open: boolean; onOpenChange: (open: boolean) => void; onInvited: (email: string, role: string) => void }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>They receive an email with a link to join the workspace. Invitations are managed by Better Auth and expire automatically.</DialogDescription>
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
              <button type="button" className="inline-flex h-9 items-center gap-2 rounded-[2px] border border-border-strong px-3.5 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover">Cancel</button>
            </DialogClose>
            <button type="submit" className="inline-flex h-9 items-center gap-2 rounded-[2px] bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover">Send invitation</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
