import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import { Frame, SectionLabel } from "@/components/public/frame";
import { DeleteProject } from "@/components/projects/delete-project";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useRenameProjectMutation } from "@/network/mutations/useRenameProjectMutation";
import type { ProjectDetailedRequest } from "@prism-analytics/types";
import React from "react";
import { useParams, useSearchParams } from "react-router-dom";

export function ProjectSettingsGeneral() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();
  const [open, setOpen] = React.useState(false);
  const [name, setName] = React.useState("");

  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const { data, isLoading } = useProjectQuery({ slug, duration });
  const renameProjectMutation = useRenameProjectMutation(slug);

  const onRename = async () => {
    if (!data || !name.trim()) return;
    await renameProjectMutation.mutateAsync({
      projectId: data.id,
      name: name.trim(),
    });
    setOpen(false);
    setName("");
  };

  return (
    <div className="grid gap-6">
      <Frame className="p-6">
        <SectionLabel>Project name</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          Identifies your project across the Dashboard, Prism CLI, and
          Deployment URLs.
        </p>
        <div className="mt-4 flex items-center justify-between gap-4">
          {isLoading || !data ? (
            <div className="flex-1">
              <Skeleton className="h-6 w-1/3" />
            </div>
          ) : (
            <p className="text-[14px] font-medium text-text">{data.name}</p>
          )}
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!data || isLoading}>Rename project</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Rename project</DialogTitle>
                <DialogDescription>
                  Give your project a new name. The analytics key and slug stay
                  the same.
                </DialogDescription>
              </DialogHeader>
              <div className="grid gap-4 py-4">
                <div className="grid gap-2">
                  <Label htmlFor="project-name">Project name</Label>
                  <Input
                    id="project-name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    placeholder={data?.name}
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
                  onClick={onRename}
                  disabled={renameProjectMutation.isPending || !name.trim()}
                >
                  {renameProjectMutation.isPending ? (
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

      <Frame destructive className="p-6">
        <SectionLabel className="text-danger">Delete project</SectionLabel>
        <p className="mt-1.5 text-[13px] text-text-muted">
          This will irreversibly remove your project and all associated
          content from Prism.
        </p>
        <div className="mt-4">
          <DeleteProject>
            <Button variant="destructive" disabled={!data || isLoading}>
              Delete project
            </Button>
          </DeleteProject>
        </div>
      </Frame>
    </div>
  );
}
