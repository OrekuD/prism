import { AlertTriangle, Loader2 } from "@/components/ui/hugeicons";
import React from "react";
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

import { useDeleteProjectMutation } from "@/network/mutations/useDeleteProjectMutation";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism-analytics/types";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";

export function DeleteProject(props: React.PropsWithChildren) {
  const navigate = useNavigate();
  const [open, setOpen] = React.useState(false);
  const [confirmName, setConfirmName] = React.useState("");
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const duration = searchParams.get(
    "duration"
  ) as ProjectDetailedRequest["duration"];
  const projectQuery = useProjectQuery({ slug, duration });
  const deleteProjectMutation = useDeleteProjectMutation();

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (!next) setConfirmName("");
      }}
    >
      <DialogTrigger asChild>{props.children}</DialogTrigger>
      <DialogContent className="flex max-h-[85vh] w-[90vw] max-w-[480px] flex-col gap-0 overflow-hidden p-0 m-4 md:w-full md:m-0">
        <div className="flex flex-col items-center gap-3 px-6 pt-6 pb-4 text-center">
          <AlertTriangle className="size-4 text-danger" aria-hidden="true" />
          <DialogHeader className="w-full gap-2 text-center sm:text-center">
            <DialogTitle className="text-center text-[15px] font-semibold leading-tight tracking-[-0.02em] text-danger">
              Delete {projectQuery.data?.name ?? "project"}?
            </DialogTitle>
            <DialogDescription className="text-center text-[14px] leading-[1.5] text-text-muted">
              This will{" "}
              <span className="font-medium text-text">permanently delete</span>{" "}
              the project, its sources, keys, and all telemetry. This cannot be
              undone.
            </DialogDescription>
          </DialogHeader>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-6">
          <div className="rounded-[12px] border border-danger/20 bg-danger/5 px-3 py-2.5 text-[13px] leading-[1.5] text-text">
            <p className="font-medium text-danger">This will delete:</p>
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-text-muted">
              <li>All sources and ingestion keys</li>
              <li>All events, sessions, and analytics</li>
              <li>All members' access to this project</li>
            </ul>
          </div>

          <div className="grid gap-2">
            <Label htmlFor="confirm-project-name" className="text-[13px]">
              Type{" "}
              <span className="font-mono font-medium text-danger">
                {projectQuery.data?.name ?? "—"}
              </span>{" "}
              to confirm
            </Label>
            <Input
              id="confirm-project-name"
              value={confirmName}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={projectQuery.data?.name ?? "project name"}
              autoComplete="off"
              className="h-10 border-danger/20 focus-visible:border-danger focus-visible:ring-danger/20"
            />
          </div>
        </div>

        <DialogFooter className="shrink-0 bg-surface px-6 py-4">
          <Button
            variant="outline"
            className="h-10 flex-1 sm:flex-none"
            disabled={deleteProjectMutation.isPending}
            onClick={() => {
              setOpen(false);
              setConfirmName("");
            }}
          >
            Cancel
          </Button>
          <Button
            variant="destructive"
            className="h-10 flex-1 rounded-full bg-danger text-primary-foreground hover:bg-danger/90 sm:flex-none"
            disabled={
              deleteProjectMutation.isPending ||
              projectQuery.isLoading ||
              !projectQuery.data ||
              confirmName !== projectQuery.data?.name
            }
            onClick={async () => {
              if (!projectQuery.data) return;
              const response = await deleteProjectMutation.mutateAsync(
                projectQuery.data.id
              );
              if (response?.message) {
                setOpen(false);
                navigate("/projects");
              }
            }}
          >
            {deleteProjectMutation.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Delete Project"
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
