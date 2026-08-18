import React from "react";
import { useLocation } from "react-router-dom";
import { useActiveWorkspace } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { IconMenu } from "./icons";

function crumbs(pathname: string): string[] {
  const parts = pathname.split("/").filter(Boolean);
  const out: string[] = [];
  if (parts[0] === "overview") out.push("Workspace overview");
  else if (parts[0] === "account") {
    out.push("Account");
    out.push(parts[1] && parts[1] !== "general" ? parts[1] : "General");
  } else if (parts[0] === "projects") {
    const slug = parts[2];
    if (!slug) out.push("Projects");
  }
  return out;
}

export function Toolbar({ onMenu }: { onMenu?: () => void }) {
  const { pathname } = useLocation();
  const { data: activeWorkspace } = useActiveWorkspace();
  const projectsQuery = useProjectsQuery();

  const parts = pathname.split("/").filter(Boolean);
  const slug = parts[1] === "projects" ? parts[2] : undefined;
  const project = projectsQuery.data?.find((entry) => entry.slug === slug);
  const section =
    parts[1] === "projects" && parts[3] ? parts[3] : undefined;

  const workspaceName = (activeWorkspace as { name?: string } | null)?.name;
  const base = crumbs(pathname);

  const trail: Array<{ label: string | undefined; strong?: boolean }> = [];
  if (parts[0] === "projects" && slug) {
    trail.push({ label: workspaceName });
    trail.push({ label: project?.name, strong: true });
    if (section)
      trail.push({
        label: section.charAt(0).toUpperCase() + section.slice(1),
      });
  } else {
    base.forEach((label, index) =>
      trail.push({ label, strong: index === base.length - 1 }),
    );
  }

  return (
    <div className="toolbar">
      <div className="tb-left">
        <button
          type="button"
          className="btn btn-icon btn-sm tb-menu"
          aria-label="Open navigation"
          onClick={onMenu}
        >
          <IconMenu />
        </button>
        <div className="crumb">
          {trail.filter((entry) => entry.label).map((entry, index) => (
            <React.Fragment key={`${entry.label}-${index}`}>
              {index > 0 ? <span className="sep">/</span> : null}
              {entry.strong ? (
                <b className="crumb-hide">{entry.label}</b>
              ) : (
                <span className="crumb-hide">{entry.label}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="tb-right">{/* project-specific toolbar actions */}</div>
    </div>
  );
}
