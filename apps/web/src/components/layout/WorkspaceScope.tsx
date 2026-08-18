import React from "react";
import { Navigate, Outlet, useParams } from "react-router-dom";
import {
  useActiveWorkspace,
  useWorkspaces,
  workspaceActions,
} from "@/lib/workspace";

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
        <span className="h-4 w-48 animate-pulse rounded-[2px] bg-surface-raised" />
        <span className="h-4 w-32 animate-pulse rounded-[2px] bg-surface-raised" />
      </div>
    </div>
  );
}

/** Resolves `/{workspaceSlug}/overview` once the active workspace is known. */
export function useWorkspaceHome(): {
  path: string | null;
  isPending: boolean;
} {
  const { data: workspaces, isPending } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const slug =
    (active as { slug?: string } | null)?.slug ??
    (workspaces?.[0] as { slug?: string } | undefined)?.slug;
  return { path: slug ? `/${slug}/overview` : null, isPending };
}

/**
 * Workspace-scoped home: the vanity `/overview` (and any plain landing)
 * resolves to `/{activeWorkspaceSlug}/overview`. Shows a skeleton while the
 * workspace is still loading so the path never flashes as invalid.
 */
export function WorkspaceHome() {
  const { path, isPending } = useWorkspaceHome();
  if (path) return <Navigate to={path} replace />;
  if (isPending) return <HomeSkeleton />;
  return <Centered>No workspace yet. Create one to get started.</Centered>;
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
  const activeId = (active as { id?: string } | null)?.id;

  React.useEffect(() => {
    // On a fresh page load (refresh) the session's active workspace is
    // briefly pending — deciding here would kick the user off their current
    // page. Wait for both the list and the active workspace to resolve.
    if (workspacesPending || activePending) return;
    if (!workspace || activeId === workspace.id) return;
    // The URL points at a workspace the session hasn't adopted yet → adopt
    // it in place. The URL is the source of truth, so we stay on the
    // current path (no redirect to overview).
    void workspaceActions.setActive(workspace.id).catch(() => {});
  }, [workspace?.id, activeId, workspacesPending, activePending]);

  // While workspaces are still loading, render immediately — the pages and
  // sidebar show their own skeletons. Only redirect a definitively-unknown
  // slug once the data has arrived.
  if (workspaces != null && !workspace) {
    const activeSlug = (active as { slug?: string } | null)?.slug;
    if (activeSlug) return <Navigate to={`/${activeSlug}/overview`} replace />;
    return <Centered>Workspace not found.</Centered>;
  }
  return <Outlet />;
}

/** Redirect to a workspace-scoped path using the active workspace slug. */
export function RedirectToWs({ to }: { to: string }) {
  const { data: active, isPending } = useActiveWorkspace();
  const slug = (active as { slug?: string } | null)?.slug ?? "";
  if (slug) return <Navigate to={`/${slug}${to}`} replace />;
  return <HomeSkeleton />;
}

/** Redirect `/projects/:slug` (legacy) to `/:wrkSlug/projects/:slug`. */
export function RedirectToProjectWs() {
  const { slug } = useParams();
  const { data: active, isPending } = useActiveWorkspace();
  const ws = (active as { slug?: string } | null)?.slug ?? "";
  if (ws) return <Navigate to={`/${ws}/projects/${slug}`} replace />;
  return <HomeSkeleton />;
}
