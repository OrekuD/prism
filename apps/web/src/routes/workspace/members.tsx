import React from "react";
import { PageHeader } from "@/components/public/page-header";
import { toast } from "sonner";
import {
  useActiveMember,
  useActiveWorkspace,
  workspaceActions,
  type WorkspaceInvitation,
  type WorkspaceMember,
} from "@/lib/workspace";
import { authClient } from "@/lib/authClient";
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
import {
  Trash2,
  UserPlus,
  Plus,
  PencilLine,
  CircleSlash,
  Loader2,
} from "@/components/ui/hugeicons";

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  member: "Member",
};

type MemberRow = WorkspaceMember & { user?: { name?: string; email?: string } };

const TH = "whitespace-nowrap border-b border-border bg-transparent px-4 py-2.5 text-left text-[13px] font-medium tracking-normal text-text-subtle";
const TD = "border-t border-border px-4 py-[11px] align-middle leading-[1.4]";
/* Shared column widths so the members + invitations tables align
   column-for-column despite different headers. */
const TH_ROLE = `${TH} w-[180px]`;
const TH_STATUS = `${TH} w-[120px]`;
const TH_TIME = `${TH} w-[110px]`;
const TH_ACTIONS = `${TH} w-[96px]`;

export function MembersPage() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useActiveMember();
  const { data: sessionData } = authClient.useSession();
  const organizationId = (activeWorkspace as { id?: string } | null)?.id;
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;
  const ownEmail = (
    sessionData?.user as { email?: string } | null | undefined
  )?.email;
  const myRole = (activeMember as { role?: string } | null)?.role;
  const canManage = myRole === "owner" || myRole === "admin";

  const [members, setMembers] = React.useState<MemberRow[] | null>(null);
  const [invitations, setInvitations] = React.useState<WorkspaceInvitation[] | null>(null);
  const [inviteOpen, setInviteOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);

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
      <PageHeader
        title="Members"
        description={`Members of the ${workspaceName ?? "workspace"} workspace and their roles.`}
      >
        {canManage ? (
          <button
            type="button"
            onClick={() => setInviteOpen(true)}
            className="inline-flex h-9 items-center justify-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover"
          >
            <UserPlus className="size-4" />Invite member
          </button>
        ) : null}
      </PageHeader>

      <div className="mb-3 mt-10 text-[13px] font-medium tracking-normal text-text-subtle">Members</div>
      <div className="overflow-auto rounded-[16px] border border-border">
        <table className="w-full table-fixed border-collapse text-sm">
          <thead>
            <tr><th className={TH}>Member</th><th className={TH_ROLE}>Role</th><th className={TH_STATUS}>Status</th><th className={TH_TIME}>Last active</th><th className={`${TH_ACTIONS} text-right`}>Actions</th></tr>
          </thead>
          <tbody>
            {members === null ? (
              <tr><td colSpan={5} className={TD}><span className="inline-block h-[14px] w-[72px] animate-pulse rounded-md bg-surface-raised" /></td></tr>
            ) : members.length === 0 ? (
              <tr><td colSpan={5} className={`${TD} text-text-muted`}>No members yet.</td></tr>
            ) : (
              members.map((member) => {
                const displayName = member.user?.name ?? member.userId;
                return (
                  <tr key={member.id} className="group transition-colors hover:bg-surface-hover">
                    <td className={TD}>
                      <span className="flex items-center gap-2.5">
                        <span className="grid size-6 shrink-0 place-items-center rounded-full border border-border-strong bg-surface-raised text-[10px] font-semibold text-text" aria-hidden="true">
                          {getInitials(displayName)}
                        </span>
                        <span>
                          <span className="block text-sm font-medium">{displayName}</span>
                          <span className="block text-xs text-text-subtle">{member.user?.email ?? member.userId}</span>
                        </span>
                      </span>
                    </td>
                    <td className={TD}>
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
                          <SelectTrigger className="h-7 w-[180px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent align="start" className="w-[180px]">
                            <SelectItem value="admin">Admin</SelectItem>
                            <SelectItem value="member">Member</SelectItem>
                          </SelectContent>
                        </Select>
                      ) : (
                        ROLE_LABELS[member.role] ?? member.role
                      )}
                    </td>
                    <td className={TD}><span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-success/40 px-2 text-[11px] whitespace-nowrap text-success">Active</span></td>
                    <td className={`${TD} text-[12px] text-text-muted`}>—</td>
                    <td className={TD}>
                      <span className="flex items-center justify-end gap-1 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                        {canManage && member.role !== "owner" && organizationId ? (
                          <button
                            type="button"
                            disabled={busy}
                            aria-label={`Remove ${displayName}`}
                            onClick={() => void run(() => workspaceActions.removeMember({ memberId: member.id, organizationId }), "Member removed")}
                            className="inline-flex h-[30px] items-center gap-2 rounded-full px-3 text-[13px] text-text-muted transition-colors hover:bg-surface-hover hover:text-text"
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
          <div className="mb-3 mt-10 text-[13px] font-medium tracking-normal text-text-subtle">Pending invitations</div>
          {invitations === null ? (
            <span className="inline-block h-[14px] w-[72px] animate-pulse rounded-md bg-surface-raised" />
          ) : (invitations ?? []).filter((invite) => invite.status === "pending").length === 0 ? (
            <p className="text-[13px] text-text-muted">No pending invitations.</p>
          ) : (
            <div className="overflow-auto rounded-[16px] border border-border">
              <table className="w-full table-fixed border-collapse text-sm">
                <thead><tr><th className={TH}>Email</th><th className={TH_ROLE}>Role</th><th className={TH_STATUS}>Status</th><th className={TH_TIME}>Expires</th><th className={`${TH_ACTIONS} text-right`}>Actions</th></tr></thead>
                <tbody>
                  {(invitations ?? [])
                    .filter((invite) => invite.status === "pending")
                    .map((invite) => (
                      <tr key={invite.id} className="group">
                        <td className={TD}>{invite.email}</td>
                        <td className={TD}>{ROLE_LABELS[invite.role ?? "member"] ?? invite.role}</td>
                        <td className={TD}><span className="inline-flex h-[22px] items-center gap-1.5 rounded-full border border-warning/40 px-2 text-[11px] whitespace-nowrap text-warning">Pending</span></td>
                        <td className={`${TD} text-[12px] text-text-muted`}>{new Date(invite.expiresAt).toLocaleDateString()}</td>
                        <td className={TD}>
                          <span className="flex items-center justify-end">
                            <button
                              type="button"
                              disabled={busy}
                              aria-label={`Cancel invitation for ${invite.email}`}
                              onClick={() => void run(() => workspaceActions.cancelInvitation(invite.id), "Invitation cancelled")}
                              className="inline-flex size-7 items-center justify-center rounded-full text-text transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
                            >
                              <CircleSlash className="size-4" />
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

      <InviteDialog
        open={inviteOpen}
        onOpenChange={setInviteOpen}
        ownEmail={ownEmail}
        onInviteBatch={async (invitations) => {
          if (!organizationId) return { results: [] };
          const response = await workspaceActions.inviteMembers({
            organizationId,
            invitations,
          });
          // $fetch resolves { data, error } — never throws on 4xx. Surface
          // request-level failures so the dialog shows them instead of
          // silently closing.
          if (!response.data) {
            const raw = response.error as
              | { message?: unknown; errors?: unknown }
              | undefined;
            const first =
              typeof raw?.message === "string"
                ? raw.message
                : Array.isArray(raw?.errors) && typeof raw.errors[0] === "string"
                  ? raw.errors[0]
                  : null;
            throw new Error(first ?? "invite_failed");
          }
          // Optimistic: append the sent invitations immediately so the
          // pending list reflects them without waiting for a reload.
          setInvitations((current) => [
            ...(current ?? []),
            ...response.data.results
              .filter((entry) => entry.status === "sent")
              .map((entry, index) => ({
                id: `optimistic-${entry.email}-${index}`,
                organizationId,
                email: entry.email,
                role: (invitations.find(
                  (invitation) =>
                    invitation.email === entry.email,
                )?.role ?? "member") as WorkspaceInvitation["role"],
                status: "pending" as const,
                expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 48),
                inviterId: "",
              })),
          ]);
          // Reconcile with the server in the background (real ids/expiries).
          void load();
          return response.data;
        }}
      />
    </>
  );
}

function InviteDialog({ open, onOpenChange, ownEmail, onInviteBatch }: { open: boolean; onOpenChange: (open: boolean) => void; ownEmail?: string; onInviteBatch: (invitations: Array<{ email: string; role: string }>) => Promise<{ results: Array<{ email: string; status: "sent" | "error"; error?: string }> }> }) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState("member");
  const [pending, setPending] = React.useState<Array<{ email: string; role: string }>>([]);
  const [listError, setListError] = React.useState<string | null>(null);
  // Format validation fires only on an add attempt, not while typing.
  const [emailTried, setEmailTried] = React.useState(false);

  const trimmedEmail = email.trim();
  const emailError =
    emailTried && trimmedEmail !== "" && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)
      ? "Enter a valid email address."
      : null;

  /** Friendly per-entry labels for the duplicate/error family. */
  const describeInviteError = (raw?: string) => {
    if (!raw) return "Failed.";
    if (/already a member/i.test(raw)) return "Already a member.";
    if (/already invited/i.test(raw)) return "Already invited.";
    if (/invalid/i.test(raw)) return "Invalid email.";
    if (/rate.?limit/i.test(raw)) return "Too many attempts — try again shortly.";
    if (/unauthorized/i.test(raw)) return "Session expired — try again.";
    if (/invite_failed/i.test(raw)) return "Couldn't send. Try again.";
    return raw;
  };

  const addPending = () => {
    if (!trimmedEmail) return;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) {
      setEmailTried(true);
      return;
    }
    if (ownEmail && trimmedEmail.toLowerCase() === ownEmail.toLowerCase()) {
      setListError("Already a member.");
      return;
    }
    if (pending.some((entry) => entry.email === trimmedEmail)) {
      setListError(`${trimmedEmail} is already on the list.`);
      return;
    }
    setListError(null);
    setEmailTried(false);
    setPending((current) => [...current, { email: trimmedEmail, role }]);
    setEmail("");
  };

  const removePending = (target: string) => {
    setListError(null);
    setPending((current) => current.filter((entry) => entry.email !== target));
  };

  const updateRole = (target: string, role: string) => {
    setPending((current) =>
      current.map((entry) =>
        entry.email === target ? { ...entry, role } : entry,
      ),
    );
  };

  const [sending, setSending] = React.useState(false);

  const sendAll = async () => {
    if (pending.length === 0 || sending) return;
    setSending(true);
    try {
      const response = await onInviteBatch(pending);
      const failed = response.results.filter(
        (entry) => entry.status === "error",
      );
      const sent = response.results.length - failed.length;
      if (sent > 0) {
        toast.success(
          sent === 1 ? "Invitation sent" : `${sent} invitations sent`,
        );
      }
      if (failed.length === 0) {
        setPending([]);
        setListError(null);
        setEmail("");
        onOpenChange(false);
      } else {
        // Keep only the failed rows so they can be retried after fixing
        // (e.g. removing an already-invited address). Response errors are
        // toast feedback, not inline state — the rows stay visible.
        setPending((current) =>
          current.filter((entry) =>
            failed.some((failure) => failure.email === entry.email),
          ),
        );
        if (failed.length === 1) {
          toast.error(describeInviteError(failed[0].error));
        } else {
          toast.error(
            `${failed.length} of ${response.results.length} invitations failed`,
            {
              description: failed
                .map(
                  (failure) =>
                    `${failure.email} — ${describeInviteError(failure.error)}`,
                )
                .join(", "),
            },
          );
        }
      }
    } catch (error) {
      toast.error(
        describeInviteError(
          error instanceof Error && error.message
            ? error.message
            : "Could not send invitations. Try again.",
        ),
      );
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[90vw] rounded-lg sm:max-w-xl md:w-full">
        <DialogHeader>
          <DialogTitle>Invite member</DialogTitle>
          <DialogDescription>They receive an email with a link to join the workspace. Invitations are managed by Better Auth and expire automatically.</DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            addPending();
          }}
        >
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1 space-y-2">
              <Label htmlFor="invite-email">Email</Label>
              <Input
                id="invite-email"
                type="email"
                className="h-10"
                value={email}
                aria-invalid={Boolean(emailError || listError)}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (emailTried) setEmailTried(false);
                }}
                placeholder="teammate@example.com"
              />
            </div>
            <div className="shrink-0 space-y-2">
              <Label>Role</Label>
              <Select value={role} onValueChange={setRole}>
                <SelectTrigger className="h-10 w-[140px]"><SelectValue /></SelectTrigger>
                <SelectContent align="start">
                  <SelectItem value="member">Member</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Invisible label spacer keeps the + control on the same
                baseline as the other two labeled columns. */}
            <div className="shrink-0 space-y-2">
              <Label aria-hidden="true" className="select-none opacity-0">
                Add
              </Label>
              <button
                type="submit"
                disabled={!trimmedEmail}
                aria-label="Add to invite list"
                className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-accent text-primary-foreground transition-colors hover:bg-accent-hover disabled:opacity-45"
              >
                <Plus className="size-4" />
              </button>
            </div>
          </div>
          {emailError || listError ? (
            <p role="alert" className="-mt-2 text-xs text-danger">
              {emailError ?? listError}
            </p>
          ) : null}
          {pending.length > 0 ? (
            <div className="[&>*+*]:border-t-[0.5px] [&>*+*]:border-border">
              {pending.map((entry) => (
                <div
                  key={entry.email}
                  className="flex items-center gap-3 px-1 py-2"
                >
                  <p className="min-w-0 flex-1 truncate text-sm text-text">
                    {entry.email}
                  </p>
                  <Select
                    value={entry.role}
                    onValueChange={(value) =>
                      updateRole(entry.email, value)
                    }
                  >
                    <SelectTrigger
                      data-role-trigger={entry.email}
                      className="w-auto gap-1.5 rounded-full border-none bg-transparent px-1.5 text-xs shadow-none hover:bg-transparent dark:bg-transparent"
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent align="start">
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                  <span aria-hidden="true" className="h-5 w-px bg-border" />
                  <button
                    type="button"
                    aria-label={`Remove ${entry.email}`}
                    onClick={() => removePending(entry.email)}
                    className="grid size-7 shrink-0 place-items-center rounded-full text-text transition-colors hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : null}
          <DialogFooter>
            <DialogClose asChild>
              <button type="button" className="inline-flex h-9 items-center gap-2 rounded-full border border-border-strong px-4 text-sm font-medium text-text transition-colors hover:bg-surface-hover">Cancel</button>
            </DialogClose>
            <button
              type="button"
              onClick={() => void sendAll()}
              disabled={pending.length === 0 || sending}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:opacity-45"
            >
              {sending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              {pending.length > 1
                ? `Send ${pending.length} invitations`
                : "Send invitation"}
            </button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
