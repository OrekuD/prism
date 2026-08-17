import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ProjectSparkline } from "@/components/charts/project-sparkline";
import { EmptyState } from "@/components/ui/empty-state";
import { ErrorState } from "@/components/ui/error-state";
import { CreateNewProject } from "@/components/projects/create-new-project";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useActiveWorkspace } from "@/lib/workspace";
import { Search } from "lucide-react";
import React from "react";
import { Link } from "react-router-dom";

const placeholders = Array(3).fill(null);

export function Projects() {
  const projectsQuery = useProjectsQuery();
  const { refetch } = projectsQuery;
  const { data: activeWorkspace } = useActiveWorkspace();

  return (
    <div className="flex flex-1 flex-col py-4">
      <div className="flex flex-col md:flex-row md:items-center gap-3">
        <form className="flex-1">
          <div className="relative">
            <Search className="absolute left-2.5 top-3 size-4 text-muted-foreground" />
            <Input
              type="search"
              placeholder="Search projects..."
              className="pl-8 w-full"
            />
          </div>
        </form>
        <div className="flex gap-3">
          <CreateNewProject>
            <Button>New Project</Button>
          </CreateNewProject>
        </div>
      </div>
      <div className="flex flex-1 flex-col py-4">
        {projectsQuery.isLoading || projectsQuery.isRefetching ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {placeholders.map((_, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton placeholder list with no stable identity
              <Card key={index}>
                <CardHeader>
                  <Skeleton className="h-[20px]" />
                </CardHeader>
                <CardContent>
                  <Skeleton className="h-[150px]" />
                </CardContent>
              </Card>
            ))}
          </div>
        ) : (
          <>
            {projectsQuery.isError ? (
              <ErrorState
                title="Could not load projects"
                description="Prism could not reach the API. Check your connection and try again."
                onRetry={() => refetch()}
              />
            ) : projectsQuery.data && projectsQuery.data.length > 0 ? (
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                {projectsQuery.data.map(({ id, name, slug, summary }) => {
                  return (
                    <Link to={`/projects/${slug}`} key={id}>
                      <Card className="">
                        <CardHeader>
                          <CardTitle className="text-md">{name}</CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="h-[150px]">
                            <ProjectSparkline summary={summary} />
                          </div>
                        </CardContent>
                      </Card>
                    </Link>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                label="No projects"
                title={
                  activeWorkspace
                    ? `No projects in ${(activeWorkspace as { name?: string }).name ?? "this workspace"}`
                    : "No projects"
                }
                description="Create your first project, add a source, then install the SDK and verify your first event."
                action={
                  <Link
                    to="/onboarding"
                    className="inline-flex h-10 items-center rounded-[2px] bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
                  >
                    Set up your first project
                  </Link>
                }
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
