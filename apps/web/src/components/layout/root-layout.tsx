import React from "react";
import { authClient } from "@/lib/authClient";
import { useActiveWorkspace, useWorkspaces, workspaceActions } from "@/lib/workspace";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, TriangleAlert } from "lucide-react";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { DashboardLayout } from "./v2/DashboardLayout";

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
  const emailVerified = Boolean(sessionData?.user?.emailVerified);
  const { pathname } = useLocation();
  const { resend, isPending } = useResendVerificationEmail();

  // Must run before the authenticated early-return so the hook is
  // unconditional; it no-ops for signed-out/unloaded sessions.
  useEnsureActiveWorkspace();

  if (!isAuthenticated) {
    return <Navigate to="/auth/log-in" replace state={{ from: pathname }} />;
  }

  return (
    <>
      {!emailVerified ? (
        <div className="fixed inset-x-0 top-0 z-[70] border-b border-warning/30 bg-warning/10">
          <div className="mx-auto flex w-full max-w-[1800px] items-center gap-2.5 px-4 py-2.5 md:px-10">
            <TriangleAlert
              className="size-3.5 shrink-0 text-warning"
              aria-hidden="true"
            />
            <p className="min-w-0 flex-1 truncate text-[13px] text-text">
              Verify your email to create workspaces and projects.
            </p>
            <button
              type="button"
              disabled={isPending}
              aria-busy={isPending}
              onClick={() => {
                if (sessionData?.user?.email) {
                  resend(sessionData.user.email);
                }
              }}
              className="shrink-0 text-[13px] font-medium text-warning underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45"
            >
              {isPending ? (
                <Loader2
                  className="mr-1 inline size-3.5 animate-spin align-[-2px]"
                  aria-hidden="true"
                />
              ) : null}
              Resend verification email
            </button>
          </div>
        </div>
      ) : null}
      <DashboardLayout />
    </>
  );
}
