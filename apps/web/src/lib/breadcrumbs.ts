import { useLocation } from "react-router-dom";
import { useActiveWorkspace } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";

export type Crumb = { label: string; href?: string };

/**
 * Route-aware breadcrumb trail for the page-layout header (Toolbar).
 * Every signed-in page starts with the workspace name, then the active
 * page/section. The last crumb is the current page; the rest are parents.
 */
export function useBreadcrumbs(): Crumb[] {
  const { pathname } = useLocation();
  const { data: activeWorkspace } = useActiveWorkspace();
  const projectsQuery = useProjectsQuery();

  const workspace =
    (activeWorkspace as { name?: string } | null)?.name ?? "Workspace";
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];

  if (parts[0] === "projects") {
    const slug = parts[2];
    const project = projectsQuery.data?.find((p) => p.slug === slug);
    crumbs.push({ label: workspace, href: "/overview" });
    if (!slug) {
      crumbs.push({ label: "Projects" });
    } else {
      crumbs.push({ label: project?.name ?? slug, href: `/projects/${slug}` });
      const section = parts[3];
      if (section) {
        crumbs.push({ label: section.charAt(0).toUpperCase() + section.slice(1) });
      }
    }
  } else if (parts[0] === "members") {
    crumbs.push({ label: workspace, href: "/overview" });
    crumbs.push({
      label: parts[1] === "settings" ? "Settings" : "Members",
    });
  } else if (parts[0] === "overview") {
    crumbs.push({ label: workspace, href: "/overview" });
    crumbs.push({ label: "Overview" });
  } else if (parts[0] === "account") {
    crumbs.push({ label: workspace, href: "/overview" });
    crumbs.push({ label: "Account", href: "/account/general" });
    crumbs.push({
      label: parts[1] ? parts[1].charAt(0).toUpperCase() + parts[1].slice(1) : "General",
    });
  } else {
    crumbs.push({ label: workspace });
  }
  return crumbs;
}

