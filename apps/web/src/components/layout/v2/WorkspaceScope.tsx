import React from "react";
import { Navigate, Outlet, useNavigate, useParams } from "react-router-dom";
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

/**
 * Workspace-scoped home: the vanity `/overview` (and any plain landing)
 * resolves to `/{activeWorkspaceSlug}/overview`.
 */
export function WorkspaceHome() {
  const { data: workspaces } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const activeSlug = (active as { slug?: string } | null)?.slug;
  const list = (workspaces ?? []) as Array<{ slug: string }>;
  const target = activeSlug ?? list[0]?.slug;
  if (!target) return <Centered>No workspace yet.</Centered>;
  return <Navigate to={`/${target}/overview`} replace />;
}

/**
 * Guard for all `/:wrkSlug/*` routes. Reads the workspace slug from the
 * URL, resolves the matching workspace, keeps the session's active
 * workspace in sync with the URL, and renders the scoped page. Unknown
 * slugs bounce to the active workspace home.
 */
export function WorkspaceScope() {
  const { wrkSlug } = useParams();
  const navigate = useNavigate();
  const { data: workspaces } = useWorkspaces();
  const { data: active } = useActiveWorkspace();
  const list = (workspaces ?? []) as Array<{ id: string; slug: string }>;
  const workspace = list.find((w) => w.slug === wrkSlug);
  const activeId = (active as { id?: string } | null)?.id;

  const isActive = Boolean(activeId && workspace && activeId === workspace.id);

  React.useEffect(() => {
    if (!workspace || activeId === workspace.id) return;
    if (activeId != null && workspace.id !== activeId) {
      // URL points at a different workspace than the session → adopt it.
      void workspaceActions.setActive(workspace.id);
    }
    navigate(`/${workspace.slug}/overview`, { replace: true });
  }, [workspace?.id, activeId]);

  if (!workspaces) return <Centered>Loading workspace…</Centered>;
  if (!workspace) {
    const activeSlug = (active as { slug?: string } | null)?.slug;
    if (activeSlug) return <Navigate to={`/${activeSlug}/overview`} replace />;
    return <Centered>Workspace not found.</Centered>;
  }
  if (!isActive) return <Centered>Loading workspace…</Centered>;
  return <Outlet />;
}

/** Redirect to a workspace-scoped path using the active workspace slug. */
export function RedirectToWs({ to }: { to: string }) {
  const { data: active } = useActiveWorkspace();
  const slug = (active as { slug?: string } | null)?.slug ?? "";
  if (!slug) return null;
  return <Navigate to={`/${slug}${to}`} replace />;
}

/** Redirect `/projects/:slug` (legacy) to `/:wrkSlug/projects/:slug`. */
export function RedirectToProjectWs() {
  const { slug } = useParams();
  const { data: active } = useActiveWorkspace();
  const ws = (active as { slug?: string } | null)?.slug ?? "";
  if (!ws) return null;
  return <Navigate to={`/${ws}/projects/${slug}`} replace />;
}
