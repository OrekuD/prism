import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { DeleteProject } from "@/components/ui/delete-project";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism/types";
import React from "react";
import { useParams, useSearchParams } from "react-router-dom";

export function ProjectSettingsGeneral() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const { data, isLoading } = useProjectQuery({ slug, duration });

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
        <CardFooter className="border-t px-6 py-4">
          <DeleteProject>
            <Button>Rename project</Button>
          </DeleteProject>
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
