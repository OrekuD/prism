import React from "react";
import { toast } from "sonner";
import {
  useActiveMember,
  useActiveWorkspace,
  workspaceActions,
} from "@/lib/workspace";
import { Frame, SectionLabel } from "@/components/public/frame";
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

const SAVE_BTN =
  "inline-flex h-9 items-center gap-2 rounded-[2px] bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover disabled:opacity-45";
const DANGER_BTN =
  "inline-flex h-9 items-center gap-2 rounded-[2px] border border-danger/50 px-3.5 text-[13px] font-medium text-danger transition-colors hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-45";

/**
 * Workspace settings — General tab (/:wrkSlug/settings/general). Uses the
 * same Frame layout as project settings: a normal frame for the rename
 * form and a destructive frame for the delete zone.
 */
export function WorkspaceSettingsGeneral() {
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
    <div className="grid gap-6">
      {/* Rename */}
      <Frame className="p-6">
        <SectionLabel>Workspace name</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          The name of your active workspace.
        </p>
        <form onSubmit={onSave} className="mt-4 max-w-sm space-y-5">
          <div className="space-y-2">
            <Label className="text-[13px] font-medium text-text">Name</Label>
            <Input
              value={name}
              onChange={(event) => setName(event.target.value)}
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

      {/* Delete */}
      <Frame destructive className="p-6">
        <SectionLabel className="text-danger">Delete workspace</SectionLabel>
        <p className="mt-1.5 text-[13px] leading-relaxed text-text-muted">
          {isDefault
            ? "This is your default workspace and can't be deleted."
            : myRole === "owner"
              ? "Permanently delete this workspace and all of its projects, sources, and analytics. This can't be undone."
              : "Only the workspace owner can delete it."}
        </p>
        <div className="mt-4">
          <button
            type="button"
            onClick={() => setConfirmOpen(true)}
            disabled={!canDelete || deleting}
            className={DANGER_BTN}
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
    </div>
  );
}
