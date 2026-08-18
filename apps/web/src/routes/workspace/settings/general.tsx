import React from "react";
import { toast } from "sonner";
import {
  useActiveMember,
  useActiveWorkspace,
  workspaceActions,
} from "@/lib/workspace";
import { Button } from "@/components/ui/button";
import { Frame, SectionLabel } from "@/components/public/frame";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
} from "@/components/ui/alert-dialog";

/**
 * Workspace settings — General tab (/:wrkSlug/settings/general). Rename uses
 * the same read-only-name + dialog flow as project settings; delete stays
 * owner-only for non-default workspaces, confirmed via AlertDialog.
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

  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const [deleting, setDeleting] = React.useState(false);
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  const onRename = async () => {
    if (!workspace || !name.trim()) return;
    setSaving(true);
    try {
      await workspaceActions.update({
        organizationId: workspace.id,
        name: name.trim(),
      });
      toast.success("Workspace updated");
      setOpen(false);
      setName("");
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setSaving(false);
    }
  };

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
          Identifies your workspace across the Dashboard and Prism CLI.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          <p className="text-[14px] font-medium text-text">
            {workspace?.name}
          </p>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!workspace}>Rename workspace</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename workspace</DialogTitle>
                <DialogDescription>
                  Give your workspace a new name. The workspace slug stays the
                  same.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="workspace-name">Workspace name</Label>
                  <Input
                    id="workspace-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={workspace?.name}
                  />
                </div>
              </div>
              <DialogFooter>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setOpen(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  onClick={() => void onRename()}
                  disabled={saving || !name.trim()}
                >
                  {saving ? (
                    <Loader2 className="size-4 animate-spin" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </Frame>

      {/* Delete */}
      <Frame destructive className="p-6">
        <SectionLabel className="text-danger">Delete workspace</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          {isDefault
            ? "This is your default workspace and can't be deleted."
            : myRole === "owner"
              ? "This will irreversibly remove your workspace and all its projects, sources, and analytics."
              : "Only the workspace owner can delete it."}
        </p>
        <div className="mt-4">
          <Button
            variant="destructive"
            onClick={() => setConfirmOpen(true)}
            disabled={!canDelete || deleting}
          >
            Delete workspace
          </Button>
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
