import { AlertTriangle, Loader2 } from "lucide-react";
import React from "react";
import { toast } from "sonner";
import { Button } from "../ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "../ui/dialog";
import { Input } from "../ui/input";
import { Label } from "../ui/label";

import { workspaceActions } from "@/lib/workspace";

/**
 * Delete workspace confirmation (mirrors DeleteProject): a workspace owns
 * every project inside it, so this dialog carries the same weight — danger
 * header, an explicit inventory of what disappears, and typed-name
 * confirmation. Owner-only, non-default workspaces; the caller gates the
 * trigger.
 */
export function DeleteWorkspace(props: {
  workspace: { id: string; name: string } | null;
  children: React.ReactNode;
}) {
  const [open, setOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState("");
  const [deleting, setDeleting] = React.useState(false);
  const name = props.workspace?.name ?? "";

  const canConfirm =
    !deleting && props.workspace !== null && confirmName === name;

  async function onDelete() {
    if (!props.workspace || !canConfirm) return;
    setDeleting(true);
    try {
      await workspaceActions.delete(props.workspace.id);
      toast.success("Workspace deleted");
      setOpen(false);
      window.location.href = "/overview";
    } catch {
      toast.error("Something went wrong.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmName("");
      }}
    >
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent className="m-4 flex max-h-[85vh] w-[90vw] max-w-[480px] flex-col gap-0 overflow-hidden p-0 md:m-0 md:w-full">
        <div className="flex flex-col items-center gap-3 px-6 pb-4 pt-6 text-center">
          <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
          <DialogHeader className="w-full gap-2 text-center sm:text-center">
            <DialogTitle className="text-center text-[15px] font-semibold leading-tight tracking-[-0.02em] text-danger">
              Delete {name || "workspace"}?
            </DialogTitle>
            <DialogDescription className="text-center text-[14px] leading-[1.5] text-text-muted">
              This will{" "}
              <span className="font-medium text-text">
                permanently delete
              </span>{" "}
              the workspace, every project inside it, and all of
              their data. This cannot be undone.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="rounded-[2px] border border-danger/20 bg-danger/5 px-3 py-2.5 text-[13px] leading-[1.5] text-text">
            <p className="font-medium text-danger">This will delete:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-muted">
              <li>All projects in this workspace</li>
              <li>All sources and ingestion keys</li>
              <li>All events, sessions, and analytics</li>
              <li>All members&apos; access to this workspace</li>
            </ul>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm-workspace-name" className="text-[13px]">
              Type{" "}
              <span className="font-mono font-medium text-danger">
                {name || "—"}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-workspace-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={name || "workspace name"}
              autoComplete="off"
              className="h-10 border-danger/20 focus-visible:border-danger focus-visible:ring-danger/20"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 bg-surface px-6 py-4">
          <Button
            variant="outline"
            className="h-10 flex-1 sm:flex-none"
            disabled={deleting}
            onClick={() => {
              setOpen(false);
              setConfirmName("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-10 flex-1 bg-danger text-white hover:bg-danger/90 sm:flex-none"
            disabled={!canConfirm}
            onClick={() => void onDelete()}
          >
            {deleting ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Delete Workspace"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
