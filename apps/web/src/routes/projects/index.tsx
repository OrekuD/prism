import React from "react";
import { Link } from "react-router-dom";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useActiveWorkspace } from "@/lib/workspace";
import { CreateNewProject } from "@/components/projects/create-new-project";
import { IconFolder } from "@/components/layout/v2/icons";

const placeholders = Array(3).fill(null);

/** Honest per-project session count from the 7-day daily summaries. */
function sessionCount(project: { summary?: Array<{ desktop: number; mobile: number }> }): number {
  return (project.summary ?? []).reduce(
    (sum, row) => sum + row.desktop + row.mobile,
    0,
  );
}

export function Projects() {
  const { data: projects, isLoading, isError, refetch } = useProjectsQuery();
  const { data: activeWorkspace } = useActiveWorkspace();
  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;

  return (
    <>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, flexWrap: "wrap" }}>
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-sub">
            Tracked applications in the {workspaceName ?? "workspace"} workspace.
          </p>
        </div>
        <CreateNewProject>
          <button className="btn btn-primary">New project</button>
        </CreateNewProject>
      </div>

      <div className="sec-label">All projects</div>

      {isLoading ? (
        <div className="grid3">
          {placeholders.map((_, index) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: static skeleton list
            <div className="frame metric mk" key={index}>
              <span className="skel skel-v" />
              <span className="skel" />
            </div>
          ))}
        </div>
      ) : isError ? (
        <div className="frame panel" style={{ minHeight: 120 }}>
          <p className="muted">Could not load projects.</p>
          <button className="btn btn-secondary btn-sm" onClick={() => refetch()}>Retry</button>
        </div>
      ) : projects && projects.length > 0 ? (
        <div className="grid3">
          {projects.map((project) => {
            const sessions = sessionCount(project);
            return (
              <Link
                className="frame qlink mk"
                to={`/projects/${project.slug}`}
                key={project.id}
              >
                <span className="iw"><IconFolder /></span>
                <h3>{project.name}</h3>
                <p>
                  <span className="mono" style={{ fontSize: 12, color: "var(--text-subtle)" }}>
                    {project.slug}
                  </span>
                </p>
                <p style={{ marginTop: -8 }}>
                  {sessions > 0 ? (
                    <>
                      <span className="num" style={{ font: "650 22px/1 var(--font-mono)", color: "var(--text)" }}>
                        {sessions.toLocaleString()}
                      </span>{" "}
                      <span style={{ fontSize: 12, color: "var(--text-subtle)" }}>sessions</span>
                    </>
                  ) : (
                    <span style={{ font: "500 12px/1 var(--font-mono)", color: "var(--text-subtle)" }}>
                      WAITING FOR EVENTS
                    </span>
                  )}
                </p>
                <span className="go">Open project <Go /></span>
              </Link>
            );
          })}
        </div>
      ) : (
        <div className="frame setup mk" style={{ padding: 24 }}>
          <div className="setup-head">
            <div>
              <h3>{workspaceName ? `No projects in ${workspaceName}` : "No projects yet"}</h3>
              <p>Create your first project, add a source, then install the SDK and verify your first event.</p>
            </div>
            <Link to="/onboarding" className="btn btn-secondary btn-sm">Set up your first project</Link>
          </div>
        </div>
      )}
    </>
  );
}

function Go() {
  return (
    <svg style={{ width: 11, height: 11 }} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12h14" />
      <path d="m12 5 7 7-7 7" />
    </svg>
  );
}
