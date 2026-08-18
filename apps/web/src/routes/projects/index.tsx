import React from "react";
import { Link } from "react-router-dom";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useActiveWorkspace } from "@/lib/workspace";
import { CreateNewProject } from "@/components/projects/create-new-project";
import { Frame } from "@/components/public/frame";
import { IconFolder } from "@/components/layout/v2/icons";

const placeholders = Array(3).fill(null);

/** Honest per-project session count from the 7-day daily summaries. */
function sessionCount(project: {
  summary?: Array<{ desktop: number; mobile: number }>;
}): number {
  return (project.summary ?? []).reduce(
    (sum, row) => sum + row.desktop + row.mobile,
    0
  );
}

export function Projects() {
  const { data: projects, isLoading, isError, refetch } = useProjectsQuery();
  const { data: activeWorkspace } = useActiveWorkspace();
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;

  return (
    <>
      <div
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: 16,
          flexWrap: "wrap",
        }}
      >
        <div>
          <h1 className="font-mono text-[26px] font-[650] leading-[1.18] tracking-[-0.025em] text-text">
            Projects
          </h1>
          <p className="mt-2 text-sm text-text-muted">
            Tracked applications in the {workspaceName ?? "workspace"}{" "}
            workspace.
          </p>
        </div>
        <CreateNewProject>
          <button
            type="button"
            className="inline-flex h-9 items-center gap-2 rounded-[2px] bg-accent px-3.5 text-[13px] font-medium text-primary-foreground transition-colors hover:bg-accent-hover"
          >
            New project
          </button>
        </CreateNewProject>
      </div>

      <div className="mt-10 mb-3.5 flex items-baseline gap-1.5 font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
        All projects
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {placeholders.map((_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
            <Frame
              className="flex min-h-[122px] flex-col gap-3 p-5"
              key={index}
            >
              <span className="h-[26px] w-[110px] animate-pulse rounded-[2px] bg-surface-raised" />
              <span className="h-[14px] w-[72px] animate-pulse rounded-[2px] bg-surface-raised" />
            </Frame>
          ))}
        </div>
      ) : isError ? (
        <Frame className="flex min-h-[120px] items-start gap-3 p-5">
          <p className="text-[13px] text-text-muted">
            Could not load projects.
          </p>
          <button
            className="inline-flex h-[30px] items-center gap-2 rounded-[2px] border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
            type="button"
            onClick={() => refetch()}
          >
            Retry
          </button>
        </Frame>
      ) : projects && projects.length > 0 ? (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {projects.map((project) => {
            const sessions = sessionCount(project);
            return (
              <Frame
                key={project.id}
                className="flex min-h-[128px] flex-col gap-3.5 p-5 transition-colors hover:bg-surface-hover hover:border-border-strong"
              >
                <Link
                  to={`/projects/${project.slug}`}
                  className="flex h-full flex-col gap-3.5"
                >
                  <span className="grid size-9 place-items-center rounded-[2px] border border-border bg-surface-raised">
                    <IconFolder />
                  </span>
                  <h3 className="text-[15px] font-semibold tracking-[-0.01em]">
                    {project.name}
                  </h3>
                  <p>
                    <span className="font-mono text-[12px] text-text-subtle">
                      {project.slug}
                    </span>
                  </p>
                  <p className="-mt-2">
                    {sessions > 0 ? (
                      <>
                        <span className="font-mono text-[22px] tracking-[-0.05em] text-text tabular-nums">
                          {sessions.toLocaleString()}
                        </span>{" "}
                        <span className="text-[12px] text-text-subtle">
                          sessions
                        </span>
                      </>
                    ) : (
                      <span className="font-mono text-[12px] text-text-subtle">
                        WAITING FOR EVENTS
                      </span>
                    )}
                  </p>
                  <span className="mt-auto flex items-center gap-1.5 font-mono text-[11px] tracking-[0.06em] text-link">
                    Open project <Go />
                  </span>
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
              <p className="mt-1.5 text-[13px] text-text-muted">
                Create your first project, add a source, then install the SDK
                and verify your first event.
              </p>
            </div>
            <Link
              to="/onboarding"
              className="inline-flex h-[30px] shrink-0 items-center gap-2 rounded-[2px] border border-border-strong px-3 text-[13px] font-medium text-text transition-colors hover:bg-surface-hover"
            >
              Set up your first project
            </Link>
          </div>
        </Frame>
      )}
    </>
  );
}

function Go() {
  return (
    <svg
      style={{ width: 11, height: 11 }}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
