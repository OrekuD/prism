import React from "react";
import { authClient } from "@/lib/authClient";
import { useActiveWorkspace, useWorkspaces, workspaceActions } from "@/lib/workspace";
import { Navigate, useLocation } from "react-router-dom";
import { DashboardLayout } from "./dashboard-layout";

/**
 * Auto-selects the user's first workspace once the session and workspace
 * list load, when no active workspace is set. Mirrors the API-side default
 * (AuthenticationMiddleware) so the dashboard's own org hooks never fire
 * get-active-member against a session with no active organization (which
 * 400s and retries into rate-limit 429s). Runs at most once per mount.
 */
function useEnsureActiveWorkspace() {
  const { data: workspaces, isPending: workspacesPending } = useWorkspaces();
  const { data: active, isPending: activePending } = useActiveWorkspace();
  const settled = React.useRef(false);

  React.useEffect(() => {
    if (settled.current) return;
    if (workspacesPending || activePending) return;
    settled.current = true;

    const activeId = (active as { id?: string } | null)?.id;
    const list = (workspaces ?? []) as Array<{ id: string }>;
    if (!activeId && list.length > 0) {
      void workspaceActions.setActive(list[0].id);
    }
  }, [workspaces, active, workspacesPending, activePending]);
}

/**
 * Authenticated product shell (v2 dashboard layout): a persistent 240px
 * sidebar + toolbar + content column. Signed-out visitors are redirected
 * to sign-in (the single-router design guards here instead of swapping
 * routers, which previously left protected paths on the 404 page).
 */
export function RootLayout() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const { pathname } = useLocation();

  // Must run before the authenticated early-return so the hook is
  // unconditional; it no-ops for signed-out/unloaded sessions.
  useEnsureActiveWorkspace();

  if (!isAuthenticated) {
    return <Navigate to="/auth/log-in" replace state={{ from: pathname }} />;
  }

  return <DashboardLayout />;
}
