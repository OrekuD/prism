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
import { Loader2 } from "@/components/ui/hugeicons";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { DeleteWorkspace } from "@/components/workspace/delete-workspace";

/**
 * Workspace settings — General tab (/:wrkSlug/settings/general). Rename uses
 * the same read-only-name + dialog flow as project settings; delete stays
 * owner-only for non-default workspaces, confirmed via the DeleteWorkspace dialog.
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
              <Button
                disabled={!workspace}
                className="rounded-full border border-black/10 bg-white text-black hover:bg-neutral-200"
              >
                Rename
              </Button>
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
          <DeleteWorkspace
            workspace={
              workspace ? { id: workspace.id, name: workspace.name } : null
            }
          >
            <Button
              variant="destructive"
              disabled={!canDelete}
              className="rounded-full"
            >
              Delete
            </Button>
          </DeleteWorkspace>
        </div>
      </Frame>
    </div>
  );
}
