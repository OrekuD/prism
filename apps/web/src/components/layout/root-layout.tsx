import React from "react";
import { authClient } from "@/lib/authClient";
import { Navigate, Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { Nav } from "./nav";

export function RootLayout() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const emailVerified = Boolean(sessionData?.user?.emailVerified);
  const { pathname } = useLocation();
  const { resend, isPending } = useResendVerificationEmail();

  // Signed-out visitors never see the product shell: redirect them to
  // sign-in (the single-router design guards here instead of swapping
  // routers, which previously left protected paths on the 404 page).
  if (!isAuthenticated) {
    return <Navigate to="/auth/log-in" replace state={{ from: pathname }} />;
  }

  return (
    <div className="flex min-h-dvh flex-col">
      {!emailVerified ? (
        <div className="border-b border-warning/30 bg-warning/10">
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-center gap-x-3 gap-y-1 px-4 py-2 text-sm">
            <span>
              Verify your email to create teams and projects.
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 px-2.5"
              disabled={isPending}
              onClick={() => {
                if (sessionData?.user?.email) {
                  resend(sessionData.user.email);
                }
              }}
            >
              {isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                "Resend verification email"
              )}
            </Button>
          </div>
        </div>
      ) : null}
      <Nav />
      <div className="mx-auto flex w-full max-w-[1800px] flex-1 flex-col px-4 pt-32 md:px-10 md:pt-16">
        <Outlet />
      </div>
    </div>
  );
}
