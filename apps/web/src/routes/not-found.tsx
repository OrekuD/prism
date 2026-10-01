import { Link } from "react-router-dom";
import { authClient } from "@/lib/authClient";

/**
 * Branded not-found page (design-system.md 5 / task-5 5): works in both
 * the public and authenticated trees; the CTA adapts to the session.
 */
export function NotFound() {
  const { data: sessionData } = authClient.useSession();
  const isAuthenticated = Boolean(sessionData?.session);

  return (
    <div className="flex w-full flex-1 items-center justify-center px-6 py-16">
      <div className="grid place-items-center gap-4 text-center">
        <p className="font-mono text-[64px] font-semibold leading-none tracking-[-0.04em] text-text">
          404
        </p>
        <p className="text-[13px] font-medium tracking-normal text-text-subtle">
          Page not found
        </p>
        <p className="max-w-[44ch] text-[14px] leading-relaxed text-text-muted">
          The page you're looking for does not exist or has moved. Check the
          address or head back to a known place.
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Link
            to={isAuthenticated ? "/projects" : "/"}
            className="inline-flex h-10 items-center rounded-full bg-accent px-4 text-[13px] font-medium text-primary-foreground transition-colors duration-150 hover:bg-accent-hover"
          >
            {isAuthenticated ? "Back to projects" : "Back to the landing page"}
          </Link>
          {!isAuthenticated ? (
            <Link
              to="/auth/log-in"
              className="text-[13px] text-text-muted transition-colors duration-150 hover:text-text hover:underline"
            >
              Sign in
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}
