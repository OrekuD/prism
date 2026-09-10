import React from "react";
import { Link, Navigate } from "react-router-dom";
import { authClient } from "@/lib/authClient";
import { loadRuntimeConfig } from "@/lib/runtimeConfig";
import { PrismMark } from "@/components/brand/prism-mark";
import { useTheme } from "@/components/theme-provider";
import { Monitor, Moon, Sun } from "@/components/ui/hugeicons";
import {
  HomeSkeleton,
  useWorkspaceHome,
} from "@/components/workspace/workspace-scope";

/**
 * Debug-only theme switcher (remove before shipping): cycles
 * dark → light → system from a fixed button at the top-right of any
 * auth screen.
 */
function DebugThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = theme === "dark" ? "light" : theme === "light" ? "system" : "dark";
  const label = next === "system" ? "system" : next;
  return (
    <button
      type="button"
      onClick={() => setTheme(next)}
      className="fixed top-3 right-3 z-100 inline-flex h-8 items-center gap-1.5 rounded-full border border-border bg-canvas px-2.5 text-xs font-medium text-text-muted shadow-md transition-colors hover:bg-surface-hover hover:text-text"
      title={`Theme: ${theme} — click for ${next}`}
    >
      {theme === "dark" ? (
        <Moon className="size-3.5" aria-hidden="true" />
      ) : theme === "light" ? (
        <Sun className="size-3.5" aria-hidden="true" />
      ) : (
        <Monitor className="size-3.5" aria-hidden="true" />
      )}
      Theme: {theme}
    </button>
  );
}

// Do not subscribe to organization queries on the signed-out form. Those
// requests cannot succeed yet and can leave mounted hooks holding a 401.
function AuthenticatedDestination() {
  const { path, isPending } = useWorkspaceHome();
  if (path) return <Navigate to={`${path}/projects`} replace />;
  return isPending ? <HomeSkeleton /> : <Navigate to="/overview" replace />;
}

/**
 * Shared authentication shell: a single centered column under the Prism
 * mark with a shared mount fade-up. No framed container — pages render
 * centered content directly (matches the redesigned log-in).
 */
export function AuthShell({
  children,
  title,
  redirectPaused = false,
}: {
  children: React.ReactNode;
  /** Browser-tab title. Defaults to "<instance> - sign in". */
  title?: string;
  /** The submitting page owns navigation until its session handoff finishes. */
  redirectPaused?: boolean;
}) {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);

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
  if (isAuthenticated && !redirectPaused) {
    return <AuthenticatedDestination />;
  }

  return (
    <div className="flex min-h-dvh flex-1 flex-col items-center justify-center px-6 py-12 sm:py-20">
      <DebugThemeToggle />
      <div className="w-full max-w-[360px] sm:-translate-y-6">
        <div className="animate-in fade-in slide-in-from-bottom-3 delay-200 duration-200 ease-out fill-mode-both">
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
