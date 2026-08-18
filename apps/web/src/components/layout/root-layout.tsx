import React from "react";
import { authClient } from "@/lib/authClient";
import { Navigate, useLocation } from "react-router-dom";
import { Loader2, TriangleAlert } from "lucide-react";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { DashboardLayout } from "./v2/DashboardLayout";

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
