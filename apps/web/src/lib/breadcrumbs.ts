import {
	SOURCE_TYPE_WORDS,
	sourceTabLabel,
	sourceTypeLabel,
} from "@/lib/sources";
import { useActiveWorkspace } from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { useSourcesQuery } from "@/network/queries/useSourcesQuery";
import { useLocation } from "react-router-dom";

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
	const wrkSlug = (activeWorkspace as { slug?: string } | null)?.slug ?? "";
	const parts = pathname.split("/").filter(Boolean);
	// parts for /workspace/:wrkSlug/projects/:slug/... is
	// [workspace, wrkSlug, projects, slug, sub, seg, tab]
	const projectSlug = parts[2] === "projects" ? parts[3] : undefined;
	const sub = parts[4];
	// Only fetch sources when we're on a source-detail crumb (seg is a source id, not a type word)
	const segForSource = sub === "sources" ? parts[5] : undefined;
	const needsSourceName =
		segForSource !== undefined && !SOURCE_TYPE_WORDS.includes(segForSource);
	const sourcesQuery = useSourcesQuery(needsSourceName ? projectSlug : undefined);
	const crumbs: Crumb[] = [];
	const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

	if (parts[0] === "account") {
		crumbs.push({ label: workspace, href: `/workspace/${wrkSlug}/overview` });
		crumbs.push({ label: "Account", href: "/account/general" });
		crumbs.push({ label: parts[1] ? cap(parts[1]) : "General" });
		return crumbs;
	}

	// Workspace-scoped pages: parts = ["workspace", wrkSlug, section, ...].
	crumbs.push({ label: workspace, href: `/workspace/${wrkSlug}/overview` });
	const section = parts[2];

	if (!section || section === "overview") {
		crumbs.push({ label: "Overview" });
	} else if (section === "members") {
		crumbs.push({ label: "Members" });
	} else if (section === "settings") {
		crumbs.push({ label: "Settings" });
	} else if (section === "projects") {
		crumbs.push({ label: "Projects" });
		if (projectSlug) {
			const project = projectsQuery.data?.find((p) => p.slug === projectSlug);
			crumbs.push({
				label: project?.name ?? projectSlug,
				href: `/workspace/${parts[1]}/projects/${projectSlug}`,
			});
			if (sub === "sources") {
				crumbs.push({
					label: "Sources",
					href: `/workspace/${parts[1]}/projects/${projectSlug}/sources`,
				});
				const seg = parts[5];
				if (seg) {
					if (SOURCE_TYPE_WORDS.includes(seg)) {
						if (parts[6]) {
							crumbs.push({
								label: sourceTypeLabel(seg),
								href: `/workspace/${parts[1]}/projects/${projectSlug}/sources/${seg}`,
							});
							crumbs.push({ label: sourceTabLabel(parts[6]) });
						} else {
							crumbs.push({ label: sourceTypeLabel(seg) });
						}
					} else {
						const source = sourcesQuery.data?.find((entry) => entry.id === seg);
						crumbs.push({ label: source?.name ?? seg });
					}
				}
			} else if (sub) {
				crumbs.push({ label: sub.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) });
			}
		}
	} else {
		crumbs.push({ label: workspace });
	}
	return crumbs;
}
