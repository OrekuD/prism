import React from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  useActiveMember,
  useActiveWorkspace,
  useWorkspaces,
  workspaceActions,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from "@/lib/workspace";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { CreateWorkspaceDialog } from "@/components/workspace/workspace-switcher";
import { getInitials } from "@/utils/getInitials";
import { Plus, UserPlus, Trash2, LogOut } from "lucide-react";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

/**
 * Workspace management (Task 13): every mutation goes through Better
 * Auth's Organization client APIs — membership, invitations, roles, and
 * deletion are the plugin's supported behavior, never Prism routes.
 */
export function AccountWorkspaces() {
  const { data: workspaces, isPending } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const navigate = useNavigate();
  const [selectedId, setSelectedId] = React.useState<string | null>(null);

  const list = (workspaces ?? []) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  const activeId = (active as { id?: string } | null)?.id ?? list[0]?.id;
  const selected = list.find((entry) => entry.id === selectedId) ?? list.find((entry) => entry.id === activeId);

  if (isPending && list.length === 0) {
    return <Skeleton className="h-[200px] w-full" />;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Workspaces</h2>
          <p className="text-muted-foreground">
            Workspaces are the tenant for your projects, sources, and members.
            Membership and roles are managed through Better Auth.
          </p>
        </div>
        <WorkspaceCreateButton />
      </div>

      <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Your workspaces</CardTitle>
          </CardHeader>
          <CardContent className="space-y-1">
            {list.length === 0 ? (
              <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            ) : (
              list.map((entry) => (
                <button
                  type="button"
                  key={entry.id}
                  className={`w-full rounded px-3 py-2 text-left text-sm transition-colors ${
                    selected?.id === entry.id
                      ? "bg-muted font-medium"
                      : "hover:bg-muted/60"
                  }`}
                  onClick={() => setSelectedId(entry.id)}
                >
                  {entry.name}
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {selected ? (
          <WorkspacePanel key={selected.id} organizationId={selected.id} />
        ) : null}
      </div>

      <InvitationsPanel />
    </div>
  );
}

function WorkspaceCreateButton() {
  const [open, setOpen] = React.useState(false);
  return (
    <>
      <Button onClick={() => setOpen(true)}>
        <Plus className="size-4" /> New workspace
      </Button>
      <CreateWorkspaceDialog open={open} onOpenChange={setOpen} />
    </>
  );
}

function WorkspacePanel({ organizationId }: { organizationId: string }) {
  const { data: active } = useActiveWorkspace();
  const { data: activeMember } = useActiveMember();
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [members, setMembers] = React.useState<WorkspaceMember[] | null>(null);
  const [invitations, setInvitations] = React.useState<WorkspaceInvitation[] | null>(null);
  const [busy, setBusy] = React.useState(false);
  const navigate = useNavigate();

  const activeId = (active as { id?: string } | null)?.id;
  const myMember = (activeMember as { role?: string } | null)?.role;
  const canManage = myMember === "owner" || myMember === "admin";

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const [memberResult, inviteResult] = await Promise.all([
        workspaceActions.listMembers(organizationId),
        workspaceActions.listInvitations(organizationId),
      ]);
      if (cancelled) return;
      setMembers(
        (memberResult as { data?: { members?: WorkspaceMember[] } })?.data
          ?.members ?? null,
      );
      setInvitations(
        (inviteResult as { data?: WorkspaceInvitation[] })?.data ?? null,
      );
    }
    setMembers(null);
    setInvitations(null);
    void load();
    return () => {
      cancelled = true;
    };
  }, [organizationId]);

  async function run(action: () => Promise<unknown>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
      const [memberResult, inviteResult] = await Promise.all([
        workspaceActions.listMembers(organizationId),
        workspaceActions.listInvitations(organizationId),
      ]);
      setMembers(
        (memberResult as { data?: { members?: WorkspaceMember[] } })?.data
          ?.members ?? null,
      );
      setInvitations(
        (inviteResult as { data?: WorkspaceInvitation[] })?.data ?? null,
      );
    } catch (error) {
      const message = String((error as { message?: unknown })?.message ?? error);
      if (message.includes("YOU_ARE_NOT_ALLOWED")) {
        toast.error("You don't have permission to do that.");
      } else {
        toast.error("Something went wrong.");
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Members</div>
      <div className="overflow-auto rounded-[2px] border border-border">
        <table className="w-full border-collapse text-[13px]">
          <thead>
            <tr>
              <th className="whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Member</th>
              <th className="whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Role</th>
              <th className="whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Status</th>
              <th className="whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">Last active</th>
              <th className="whitespace-nowrap border-b border-border bg-canvas-subtle px-3.5 py-2.5 text-left font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {members === null ? (
              <tr><td colSpan={5} className="border-t border-border px-3.5 py-[11px]"><span className="inline-block h-[14px] w-[72px] animate-pulse rounded-[2px] bg-surface-raised" /></td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={5} className="border-t border-border px-3.5 py-[11px] text-text-muted">No members.</td></tr>
            ) : (
              members.map((member) => {
                const user = (member as unknown as { user?: { name?: string; email?: string } }).user;
                const displayName = user?.name ?? member.userId;
                return (
                  <tr key={member.id} className="group transition-colors hover:bg-surface-hover">
                    <td className="border-t border-border px-3.5 py-[11px] align-middle leading-[1.4]">
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised font-mono text-[10px] font-semibold text-text" aria-hidden="true">
                          {getInitials(displayName)}
                        </span>
                        <span>
                          <span className="block text-[13px] font-medium">{displayName}</span>
                          <span className="block text-[12px] text-text-subtle">{user?.email ?? member.userId}</span>
                        </span>
                      </span>
                    </td>
                    <td className="border-t border-border px-3.5 py-[11px] align-middle font-mono leading-[1.4]">
                      {canManage && member.role !== "owner" ? (
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
                    <td className="border-t border-border px-3.5 py-[11px]"><span className="inline-flex h-[22px] items-center gap-1.5 rounded-[2px] border border-success/40 px-2 font-mono text-[11px] whitespace-nowrap text-success">Active</span></td>
                    <td className="border-t border-border px-3.5 py-[11px] text-[12px] text-text-muted">—</td>
                    <td className="border-t border-border px-3.5 py-[11px]">
                      <span className="flex items-center justify-end opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        {canManage && member.role !== "owner" ? (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() =>
                              void run(
                                () => workspaceActions.removeMember({ memberId: member.id, organizationId }),
                                "Member removed",
                              )
                            }
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
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Pending invitations</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            <Button onClick={() => setInviteOpen(true)} disabled={busy}>
              <UserPlus className="size-4" /> Invite member
            </Button>
            {invitations !== null && invitations.length > 0 ? (
              invitations
                .filter((invite) => invite.status === "pending")
                .map((invite) => (
                  <div key={invite.id} className="flex items-center justify-between rounded border p-3">
                    <div>
                      <p className="text-sm font-medium">{invite.email}</p>
                      <p className="text-xs text-muted-foreground">
                        {ROLE_LABELS[invite.role ?? "member"]} · expires{" "}
                        {new Date(invite.expiresAt).toLocaleDateString()}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        void run(() => workspaceActions.cancelInvitation(invite.id), "Invitation cancelled")
                      }
                    >
                      Cancel
                    </Button>
                  </div>
                ))
            ) : (
              <p className="text-sm text-muted-foreground">No pending invitations.</p>
            )}
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Danger zone</CardTitle>
        </CardHeader>
        <CardContent className="flex gap-2">
          <Button
            variant="outline"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await workspaceActions.leave(organizationId);
                navigate("/overview");
              }, "Left workspace")
            }
          >
            <LogOut className="size-4" /> Leave workspace
          </Button>
          {myMember === "owner" ? (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="destructive" disabled={busy}>
                  <Trash2 className="size-4" /> Delete workspace
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
                  <AlertDialogDescription>
                    All projects, sources, and analytics are removed. This
                    can't be undone.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    className="bg-danger text-white hover:bg-danger/90"
                    onClick={async (event) => {
                      event.preventDefault();
                      await run(async () => {
                        await workspaceActions.delete(organizationId);
                        navigate("/overview");
                      }, "Workspace deleted");
                    }}
                  >
                    Delete workspace
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : null}
        </CardContent>
      </Card>

      <InviteDialog
        organizationId={organizationId}
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        onInvited={(email, role) =>
          void run(
            () =>
              workspaceActions.inviteMember({
                organizationId,
                email,
                role: role as "owner" | "admin" | "member",
              }),
            `Invitation sent to ${email}`,
          )
        }
      />
    </div>
  );
}

function InviteDialog({
  organizationId,
  open,
  onOpenChange,
  onInvited,
}: {
  organizationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onInvited: (email: string, role: string) => void;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  void organizationId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] md:w-full rounded-lg">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>
            The invitation is managed by Better Auth — it expires automatically
            and can be cancelled at any time.
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
            <Input
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="teammate@example.com"
            />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={role} onValueChange={setRole}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="member">Member</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline">Cancel</Button>
            </DialogClose>
            <Button type="submit">Send invitation</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Pending invitations for the signed-in user (acceptance is a Better
 * Auth action — no legacy token route). */
function InvitationsPanel() {
  const [invitations, setInvitations] = React.useState<WorkspaceInvitation[] | null>(null);
  const [busy, setBusy] = React.useState(false);

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      const rows = await workspaceActions.listUserInvitations();
      if (!cancelled) {
        setInvitations((rows as { data?: WorkspaceInvitation[] })?.data ?? null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const pending = (invitations ?? []).filter((invite) => invite.status === "pending");

  if (pending.length === 0) return null;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Invitations for you</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {pending.map((invite) => (
          <div key={invite.id} className="flex items-center justify-between rounded border p-3">
            <div>
              <p className="text-sm font-medium">Workspace invitation</p>
              <p className="text-xs text-muted-foreground">
                {ROLE_LABELS[invite.role ?? "member"]} role · expires{" "}
                {new Date(invite.expiresAt).toLocaleDateString()}
              </p>
            </div>
            <Button
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await workspaceActions.acceptInvitation(invite.id);
                  toast.success("Invitation accepted");
                  setInvitations((prev) => (prev ?? []).filter((entry) => entry.id !== invite.id));
                } catch {
                  toast.error("Could not accept the invitation");
                } finally {
                  setBusy(false);
                }
              }}
            >
              Accept
            </Button>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
