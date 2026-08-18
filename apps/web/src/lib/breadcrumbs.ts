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
  const wrkSlug =
    (activeWorkspace as { slug?: string } | null)?.slug ?? "";
  const parts = pathname.split("/").filter(Boolean);
  const crumbs: Crumb[] = [];
  const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

  if (parts[0] === "account") {
    crumbs.push({ label: workspace, href: `/${wrkSlug}/overview` });
    crumbs.push({ label: "Account", href: "/account/general" });
    crumbs.push({ label: parts[1] ? cap(parts[1]) : "General" });
    return crumbs;
  }

  // Workspace-scoped pages: parts[0] is the workspace slug.
  crumbs.push({ label: workspace, href: `/${wrkSlug}/overview` });
  const section = parts[1];

  if (!section || section === "overview") {
    crumbs.push({ label: "Overview" });
  } else if (section === "members") {
    crumbs.push({ label: "Members" });
  } else if (section === "settings") {
    crumbs.push({ label: "Settings" });
  } else if (section === "projects") {
    crumbs.push({ label: "Projects" });
    const projectSlug = parts[3];
    const project = projectsQuery.data?.find((p) => p.slug === projectSlug);
    if (projectSlug) {
      crumbs.push({
        label: project?.name ?? projectSlug,
        href: `/${parts[0]}/projects/${projectSlug}`,
      });
      const sub = parts[4];
      if (sub) crumbs.push({ label: cap(sub) });
    }
  } else {
    crumbs.push({ label: workspace });
  }
  return crumbs;
}

