import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

/** Inline GitHub mark: lucide removed brand icons; keep one icon family. */
function GitHubMark(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 16 16" fill="currentColor" aria-hidden="true" {...props}>
      <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27s1.36.09 2 .27c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8Z" />
    </svg>
  );
}

export type EnabledProviders = { github: boolean; google: boolean };

/**
 * Provider sign-in buttons (design-system.md 11.3): 42px secondary
 * outlined, icon left. Providers with no credentials on this instance are
 * hidden entirely, never shown disabled.
 */
export function SocialAuthButtons({
  providers,
  onSocial,
  actionLabel = "Continue with",
  pendingProvider = null,
  className,
}: {
  providers: EnabledProviders;
  onSocial: (provider: "github" | "google") => void;
  actionLabel?: string;
  /** Provider currently redirecting; both buttons disable while set. */
  pendingProvider?: "github" | "google" | null;
  className?: string;
}) {
  const enabled = providers.github || providers.google;
  if (!enabled) return null;

  const buttonClass =
    "flex h-[42px] items-center justify-center gap-2.5 rounded-[10px] border border-border-strong bg-canvas text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45";

  return (
    <div className={cn("grid gap-2.5", className)}>
      {providers.github ? (
        <button
          type="button"
          onClick={() => onSocial("github")}
          disabled={pendingProvider !== null}
          aria-busy={pendingProvider === "github"}
          className={buttonClass}
        >
          {pendingProvider === "github" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <GitHubMark className="size-4" />
          )}
          {actionLabel} GitHub
        </button>
      ) : null}
      {providers.google ? (
        <button
          type="button"
          onClick={() => onSocial("google")}
          disabled={pendingProvider !== null}
          aria-busy={pendingProvider === "google"}
          className={buttonClass}
        >
          {pendingProvider === "google" ? (
            <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          ) : (
            <span
              aria-hidden="true"
              className="grid size-4 place-items-center rounded-full border border-border-strong text-[10px] font-bold"
            >
              G
            </span>
          )}
          {actionLabel} Google
        </button>
      ) : null}
    </div>
  );
}
