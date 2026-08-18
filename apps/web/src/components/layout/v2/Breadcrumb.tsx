import React from "react";
import { Link, useLocation } from "react-router-dom";
import { useActiveWorkspace } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import {
  Breadcrumb as ShadcnBreadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";

type Crumb = { label: string; href?: string };

function useBreadcrumbs(): Crumb[] {
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
    crumbs.push({ label: "Members" });
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

/** Route-aware breadcrumb built on the shadcn/radix Breadcrumb primitives,
 * styled to match the v2 dashboard (mono, muted, current page in accent). */
export function Breadcrumb() {
  const crumbs = useBreadcrumbs();
  // A single-crumb breadcrumb duplicates the page title (e.g. /projects,
  // /members) — hide it there; keep it for nested routes with real paths.
  if (crumbs.length <= 1) return null;
  return (
    <ShadcnBreadcrumb className="mb-4 font-mono text-[13px]">
      <BreadcrumbList>
        {crumbs.map((crumb, index) => {
          const isLast = index === crumbs.length - 1;
          return (
            <React.Fragment key={`${crumb.label}-${index}`}>
              {index > 0 ? (
                <BreadcrumbSeparator className="text-text-subtle">/</BreadcrumbSeparator>
              ) : null}
              <BreadcrumbItem>
                {crumb.href && !isLast ? (
                  <BreadcrumbLink asChild>
                    <Link
                      to={crumb.href}
                      className="text-muted transition-colors hover:text-text"
                    >
                      {crumb.label}
                    </Link>
                  </BreadcrumbLink>
                ) : (
                  <BreadcrumbPage className="font-medium text-text">{crumb.label}</BreadcrumbPage>
                )}
              </BreadcrumbItem>
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </ShadcnBreadcrumb>
  );
}
