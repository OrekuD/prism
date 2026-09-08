import React from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import { getSelectedProjectSlug } from "@/lib/selectedProject";
import {
	setActiveOnce,
	useActiveWorkspace,
	useWorkspaces,
} from "@/lib/workspace";
import { useProjectsQuery } from "@/network/queries/useProjectsQuery";
import { toast } from "sonner";

function Centered({ children }: { children: React.ReactNode }) {
	return (
		<div className="flex h-[60vh] items-center justify-center px-6 text-center text-[13px] text-text-muted">
			{children}
		</div>
	);
}

/** Full-viewport loading skeleton for redirect targets. */
export function HomeSkeleton() {
	return (
		<div className="flex h-[100dvh] w-full items-center justify-center bg-canvas">
			<div className="flex flex-col items-center gap-3">
				<span className="h-4 w-48 animate-pulse rounded-md bg-surface-raised" />
				<span className="h-4 w-32 animate-pulse rounded-md bg-surface-raised" />
			</div>
		</div>
	);
}

/** Resolves the active workspace root once the organization is known. */
export function useWorkspaceHome(): {
	path: string | null;
	isPending: boolean;
} {
	const { data: workspaces, isPending } = useWorkspaces();
	const { data: active } = useActiveWorkspace();
	const slug =
		(active as { slug?: string } | null)?.slug ??
		(workspaces?.[0] as { slug?: string } | undefined)?.slug;
	return { path: slug ? `/workspace/${slug}` : null, isPending };
}

/**
 * Workspace-scoped home: the vanity `/overview` (and any plain landing)
 * resolves to `/{activeWorkspaceSlug}`. Shows a skeleton while the
 * workspace is still loading so the path never flashes as invalid.
 */
export function WorkspaceHome() {
	const { path, isPending } = useWorkspaceHome();
	if (path) return <Navigate to={path} replace />;
	if (isPending) return <HomeSkeleton />;
	return <Centered>No workspace yet. Create one to get started.</Centered>;
}

export function resolveWorkspaceLandingPath(
	workspaceSlug: string,
	projects: ReadonlyArray<{ slug: string }>,
	selectedProjectSlug: string | null,
): string {
	const selectedProject = projects.find(
		(project) => project.slug === selectedProjectSlug,
	);
	const project =
		selectedProject ?? (projects.length === 1 ? projects[0] : null);

	return project
		? `/workspace/${workspaceSlug}/projects/${project.slug}`
		: `/workspace/${workspaceSlug}/projects`;
}

/**
 * Workspace landing and legacy workspace-overview redirect. Projects are the
 * workspace home unless a valid last-used project (or the only project) can
 * be opened directly.
 */
export function WorkspaceLanding() {
	const { wrkSlug = "" } = useParams<{ wrkSlug: string }>();
	const projectsQuery = useProjectsQuery();

	if (projectsQuery.isLoading) return <HomeSkeleton />;

	const path = resolveWorkspaceLandingPath(
		wrkSlug,
		projectsQuery.data ?? [],
		getSelectedProjectSlug(wrkSlug),
	);
	return <Navigate to={path} replace />;
}

/**
 * Guard for all `/:wrkSlug/*` routes. Reads the workspace slug from the
 * URL, resolves the matching workspace, keeps the session's active
 * workspace in sync with the URL, and renders the scoped page. Unknown
 * slugs bounce to the active workspace home.
 */
export function WorkspaceScope() {
	const { wrkSlug } = useParams();
	const { data: workspaces, isPending: workspacesPending } = useWorkspaces();
	const { data: active, isPending: activePending } = useActiveWorkspace();
	const list = (workspaces ?? []) as Array<{ id: string; slug: string }>;
	const workspace = list.find((w) => w.slug === wrkSlug);
	const workspaceId = workspace?.id;
	const workspaceSlug = workspace?.slug;
	const activeId = (active as { id?: string } | null)?.id;
	const activeSlug = (active as { slug?: string } | null)?.slug;
	const prevSlugRef = React.useRef<string | null>(null);

	React.useEffect(() => {
		if (workspacesPending || activePending) return;
		if (!workspaceId || !workspaceSlug || activeId === workspaceId) {
			if (workspaceSlug) prevSlugRef.current = workspaceSlug;
			return;
		}
		// F2: single coordinator — dedup by target id, rollback on failure.
		const targetId = workspaceId;
		const previousSlug = prevSlugRef.current ?? activeSlug ?? null;
		prevSlugRef.current = workspaceSlug;
		void setActiveOnce(targetId).catch(() => {
			toast.error("Could not switch workspace — please try again.");
			if (previousSlug && previousSlug !== workspaceSlug) {
				window.history.replaceState(null, "", `/workspace/${previousSlug}`);
				// Hard reload to ensure query scoping returns to previous workspace
				window.location.reload();
			}
		});
	}, [
		workspaceId,
		workspaceSlug,
		activeId,
		activeSlug,
		workspacesPending,
		activePending,
	]);

	// While workspaces are still loading, render immediately — the pages and
	// sidebar show their own skeletons. Only redirect a definitively-unknown
	// slug once the data has arrived.
	if (workspaces != null && !workspace) {
		const activeSlug = (active as { slug?: string } | null)?.slug;
		if (activeSlug) return <Navigate to={`/workspace/${activeSlug}`} replace />;
		return <Centered>Workspace not found.</Centered>;
	}
	return <Outlet />;
}

/** Redirect to a workspace-scoped path using the active workspace slug. */
export function RedirectToWs({ to }: { to: string }) {
	const { data: active, isPending } = useActiveWorkspace();
	const slug = (active as { slug?: string } | null)?.slug ?? "";
	if (slug) return <Navigate to={`/workspace/${slug}${to}`} replace />;
	return <HomeSkeleton />;
}

/** Redirect `/projects/:slug` (legacy) to `/:wrkSlug/projects/:slug`. */
export function RedirectToProjectWs() {
	const { slug } = useParams();
	const { data: active, isPending } = useActiveWorkspace();
	const ws = (active as { slug?: string } | null)?.slug ?? "";
	if (ws) return <Navigate to={`/workspace/${ws}/projects/${slug}`} replace />;
	return <HomeSkeleton />;
}
