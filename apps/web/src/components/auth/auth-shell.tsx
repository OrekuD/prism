import React from "react";
import { Link, Navigate } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { PrismMark } from "@/components/brand/prism-mark";
import {
  HomeSkeleton,
  useWorkspaceHome,
} from "@/components/workspace/workspace-scope";

/**
 * Shared authentication shell: a single centered column under the Prism
 * mark with a shared mount fade-up. No framed container — pages render
 * centered content directly (matches the redesigned log-in).
 */
export function AuthShell({
  children,
  title,
}: {
  children: React.ReactNode;
  /** Browser-tab title. Defaults to "<instance> - sign in". */
  title?: string;
}) {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);
  const { path: homePath, isPending: homePending } = useWorkspaceHome();

  React.useEffect(() => {
    if (title) {
      document.title = title;
      return;
    }
    loadRuntimeConfig().then((config) => {
      document.title = `${config.instanceName} - sign in`;
    });
  }, [title]);

  // Already signed in? There's nothing to do here — bounce straight to the
  // dashboard (scoped URL) instead of a vanity path that has to re-resolve.
  if (isAuthenticated) {
    if (homePath) return <Navigate to={homePath} replace />;
    if (homePending) return <HomeSkeleton />;
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-6 py-12 sm:py-20">
      <div className="w-full max-w-[360px] sm:-translate-y-6">
        <div className="animate-in fade-in slide-in-from-bottom-3 delay-300 duration-500 ease-out fill-mode-both">
          <div className="mb-7 flex justify-center">
            <Link
              to="/"
              aria-label="Prism home"
              className="grid size-12 place-items-center rounded-xl focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-focus"
            >
              <PrismMark size={40} decorative />
            </Link>
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

/** "or continue with email" divider with hairlines. */
export function OrEmailDivider() {
  return (
    <div className="flex items-center gap-4 py-1">
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
      <span className="text-[12px] text-text-muted">
        or continue with email
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border" />
    </div>
  );
}
