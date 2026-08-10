import React from "react";
import { authClient } from "@/lib/authClient";
import { Outlet, useLocation } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useResendVerificationEmail } from "@/hooks/useResendVerificationEmail";
import { Nav } from "./nav";

const excludedPaths = ["/join"];

export function RootLayout() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const emailVerified = Boolean(sessionData?.user?.emailVerified);
  const { pathname } = useLocation();
  const { resend, isPending } = useResendVerificationEmail();

  if (isAuthenticated) {
    return (
      <>
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
        {excludedPaths.includes(pathname) ? null : <Nav />}
        <div
          className={`max-w-[1800px] mx-auto px-4 md:px-10 ${excludedPaths.includes(pathname) ? "" : "pt-32 md:pt-16"}`}
        >
          <Outlet />
        </div>
      </>
    );
  }

  return (
    <>
      <div className="py-3 max-w-[1800px] mx-auto px-4 md:px-10">
        <Outlet />
      </div>
    </>
  );
}
