import { AlertTriangle, RefreshCw } from "lucide-react";

/**
 * Persistent contextual error state for route/API failures
 * (design-system.md 15.3): inline, retryable, never a toast.
 */
export function ErrorState({
  title = "Something went wrong",
  description = "Prism could not load this view. Check your connection and try again.",
  onRetry,
}: {
  title?: string;
  description?: string;
  onRetry?: () => void;
}) {
  return (
    <div
      role="alert"
      className="grid place-items-center gap-3 border border-danger/40 bg-danger/10 px-6 py-12 text-center"
    >
      <AlertTriangle className="size-5 text-danger" aria-hidden="true" />
      <p className="text-[15px] font-semibold text-text">{title}</p>
      <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
        {description}
      </p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-1 inline-flex h-9 items-center gap-2 rounded-[2px] border border-border-strong bg-canvas px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
        >
          <RefreshCw className="size-3.5" aria-hidden="true" />
          Try again
        </button>
      ) : null}
    </div>
  );
}
