import React from "react";
import { Link, useParams } from "react-router-dom";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useActiveWorkspace } from "@/lib/workspace";
import { Frame } from "@/components/public/frame";
import { CreateProjectDialog } from "@/components/projects/create-project-dialog";
import { PageHeader } from "@/components/public/page-header";
import { IconFolder } from "@/components/ui/icons";

const PROJECT_SKELETON_KEYS = [
  "project-skeleton-one",
  "project-skeleton-two",
  "project-skeleton-three",
];

export function Projects() {
  const { data: projects, isLoading, isError, refetch } = useProjectsQuery();
  const { data: activeWorkspace } = useActiveWorkspace();
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;
  const { wrkSlug } = useParams<{ wrkSlug: string }>();
  const [newProjectOpen, setNewProjectOpen] = React.useState(false);

  return (
    <>
      <PageHeader
        title="Projects"
        description={`Tracked applications in the ${workspaceName ?? "workspace"} workspace.`}
      >
        <button
          type="button"
          onClick={() => setNewProjectOpen(true)}
          className="inline-flex h-9 items-center gap-2 rounded-full bg-accent px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-accent-hover"
        >
          New project
        </button>
      </PageHeader>
      <CreateProjectDialog
        open={newProjectOpen}
        onOpenChange={setNewProjectOpen}
      />

      <div className="mb-3 mt-10 text-[13px] font-medium tracking-normal text-text-subtle">
        All projects
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {PROJECT_SKELETON_KEYS.map((key) => (
            <Frame
              className="flex min-h-[122px] flex-col gap-3 p-5"
              key={key}
            >
              <span className="h-[26px] w-[110px] animate-pulse rounded-md bg-surface-raised" />
              <span className="h-[14px] w-[72px] animate-pulse rounded-md bg-surface-raised" />
            </Frame>
          ))}
        </div>
      ) : isError ? (
        <Frame className="flex min-h-[120px] items-start gap-3 p-5">
          <p className="text-sm text-text-muted">
            Could not load projects.
          </p>
          <button
            className="inline-flex h-[30px] items-center gap-2 rounded-full border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
            type="button"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </Frame>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            return (
              <Frame
                key={project.id}
                className="flex min-h-[122px] flex-col gap-3.5 p-5 transition-colors hover:bg-surface-hover hover:border-border-strong"
              >
                <Link
                  to={`/workspace/${wrkSlug}/projects/${project.slug}`}
                  className="flex h-full flex-col gap-3.5"
                >
                  <span className="grid size-9 place-items-center rounded-[10px] border border-border bg-surface-raised">
                    <IconFolder />
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                    {project.name}
                  </h3>
                  <p>
                    <span className="text-xs tabular-nums text-text-subtle">
                      {project.slug}
                    </span>
                  </p>
                </Link>
              </Frame>
            );
          })}
        </div>
      ) : (
        <Frame className="p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                {workspaceName
                  ? `No projects in ${workspaceName}`
                  : "No projects yet"}
              </h3>
              <p className="mt-1.5 text-sm text-text-muted">
                Create your first project, add a source, then install the SDK
                and verify your first event.
              </p>
            </div>
          <Link
              to="/onboarding"
              className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-full border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
            >
              Set up your first project
            </Link>
          </div>
        </Frame>
      )}
    </>
  );
}
