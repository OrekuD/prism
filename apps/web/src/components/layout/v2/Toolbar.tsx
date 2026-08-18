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
    <div className="sticky top-0 z-40 mx-auto flex h-14 w-full max-w-[1800px] items-center justify-between gap-4 border-b border-border bg-canvas px-7">
      <div className="flex min-w-0 items-center gap-3">
        <button
          type="button"
          className="hidden size-[30px] items-center justify-center gap-2 rounded-[2px] text-[13px] font-medium transition-colors hover:bg-surface-hover max-[1023px]:inline-flex"
          aria-label="Open navigation"
          onClick={onMenu}
        >
          <IconMenu />
        </button>
        <div className="flex min-w-0 items-center gap-2 whitespace-nowrap text-[13px] text-text-muted">
          {trail.filter((entry) => entry.label).map((entry, index) => (
            <React.Fragment key={`${entry.label}-${index}`}>
              {index > 0 ? <span className="text-text-subtle">/</span> : null}
              {entry.strong ? (
                <b className="font-semibold text-text max-[767px]:hidden">{entry.label}</b>
              ) : (
                <span className="max-[767px]:hidden">{entry.label}</span>
              )}
            </React.Fragment>
          ))}
        </div>
      </div>
      <div className="flex items-center gap-3">{/* project toolbar actions */}</div>
    </div>
  );
}
