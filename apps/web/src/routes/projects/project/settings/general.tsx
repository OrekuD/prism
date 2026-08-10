import { Button } from "@/components/ui/button";
import { Loader2 } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
import type { ProjectDetailedRequest } from "@prism/types";
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
      <Card>
        <CardHeader className="gap-1">
          <CardTitle>Project Name</CardTitle>
          <CardDescription>
            Identifies your Project across the Dashboard, Prism CLI, and
            Deployment URLs.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {isLoading || !data ? (
            <Skeleton className="w-full h-6" />
          ) : (
            <p className="text-sm font-medium">{data.name}</p>
          )}
        </CardContent>
        <CardFooter className="border-t px-6 py-4">
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
                  disabled={
                    renameProjectMutation.isPending || !name.trim()
                  }
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
        </CardFooter>
      </Card>
      <Card className="border-destructive">
        <CardHeader className="gap-1">
          <CardTitle className="text-destructive">Delete Project</CardTitle>
          <CardDescription>Warning: Permanent Project Deletion</CardDescription>
          <CardDescription>
            This will irreversibly remove your Project and all associated
            content from Prism.
          </CardDescription>
        </CardHeader>
        <CardFooter className="border-t px-6 py-4">
          <DeleteProject>
            <Button variant="destructive" disabled={!data || isLoading}>
              Delete project
            </Button>
          </DeleteProject>
        </CardFooter>
      </Card>
    </div>
  );
}
