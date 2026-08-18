import React from "react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import {
  useActiveMember,
  useActiveWorkspace,
  workspaceActions,
} from "@/lib/workspace";
import { Frame } from "@/components/public/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Trash2 } from "lucide-react";

const SECTION =
  "mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted";
const SAVE_BTN =
  "inline-flex h-9 items-center gap-2 rounded-[2px] bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:opacity-45";
const DANGER_BTN =
  "inline-flex h-9 items-center gap-2 rounded-[2px] border border-danger/50 px-3.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-45";

export function WorkspaceSettingsPage() {
  const navigate = useNavigate();
  const { data: activeWorkspace } = useActiveWorkspace();
  const { data: activeMember } = useActiveMember();

  const workspace = (activeWorkspace ?? null) as {
    id: string;
    name: string;
    slug: string;
    metadata?: Record<string, unknown> | null;
  } | null;
  const myRole = (activeMember as { role?: string } | null)?.role;
  const isDefault = workspace?.metadata?.default === true;
  const canDelete = myRole === "owner" && !isDefault;

  const [name, setName] = React.useState(workspace?.name ?? "");
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  React.useEffect(() => {
    setName(workspace?.name ?? "");
  }, [workspace?.name]);

  async function onSave(event: React.FormEvent) {
    event.preventDefault();
    if (!workspace || !name.trim() || name.trim() === workspace.name) return;
    setSaving(true);
    try {
      await workspaceActions.update({
        organizationId: workspace.id,
        name: name.trim(),
      });
      toast.success("Workspace updated");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  }

  async function onDelete() {
    if (!workspace || !canDelete) return;
    setDeleting(true);
    try {
      await workspaceActions.delete(workspace.id);
      toast.success("Workspace deleted");
      window.location.href = "/overview";
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
            Workspace settings
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Manage your active workspace.
          </p>
        </div>
      </div>

      <div className={SECTION}>
        <span className="mr-1 text-text-subtle">{"//"}</span>General
      </div>
      <Frame className="p-6">
        <form onSubmit={onSave} className="space-y-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-text">
              Workspace name
            </Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
              className="max-w-sm"
              aria-label="Workspace name"
            />
          </div>
          <button type="submit" disabled={saving} className={SAVE_BTN}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" aria-hidden="true" />
            ) : null}
            Save changes
          </button>
        </form>
      </Frame>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-danger">
        <span className="mr-1 text-text-subtle">{"//"}</span>Danger zone
      </div>
      <Frame className="p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <h3 className="text-[15px] font-semibold tracking-[-0.01em] text-danger">
              Delete workspace
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
              {isDefault
                ? "This is your default workspace and can't be deleted."
                : myRole === "owner"
                  ? "Permanently delete this workspace and all of its projects, sources, and analytics. This can't be undone."
                  : "Only the workspace owner can delete it."}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canDelete || deleting}
            className={`${DANGER_BTN} shrink-0`}
            title={isDefault ? "Default workspaces are undeletable" : undefined}
          >
            <Trash2 className="size-3.5" />
            Delete workspace
          </button>
        </div>
      </Frame>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete “{workspace?.name}” and all of its
              projects, sources, and analytics. This can’t be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(event) => {
                event.preventDefault();
                void onDelete();
              }}
              disabled={deleting}
              className="bg-danger text-white hover:bg-danger/90"
            >
              {deleting ? (
                <Loader2 className="size-4 animate-spin" aria-hidden="true" />
              ) : null}
              Delete workspace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
