import { Check, Copy, Eye, EyeOff } from "lucide-react";
import React from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism/types";
import { Skeleton } from "@/components/ui/skeleton";
import { Frame } from "@/components/public/frame";
import { toast } from "sonner";

/** Masked display form of a project key. */
function maskKey(key: string): string {
  if (key.length <= 10) return "pr_••••••••";
  return `${key.slice(0, 6)}••••••••••••${key.slice(-4)}`;
}

export function ProjectSettingsApiKeys() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();
  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const { data, isLoading } = useProjectQuery({ slug, duration });
  const [revealed, setRevealed] = React.useState(false);
  const [copied, setCopied] = React.useState(false);

  const apiKey = data?.apiKey;

  const onCopy = async () => {
    if (!apiKey) return;
    try {
      await navigator.clipboard.writeText(apiKey);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
      toast.success("Project key copied");
    } catch {
      toast.error("Could not copy the key");
    }
  };

  return (
    <div className="grid gap-6">
      <Frame>
        <div className="flex flex-wrap items-end justify-between gap-4 p-6">
          <div>
            <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted">
              Project key
            </p>
            <p className="mt-1.5 max-w-[52ch] text-[13px] leading-relaxed text-text-muted">
              The SDK uses this key to send sessions and events. It is shown
              masked by default; reveal it only when you need it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setRevealed((value) => !value)}
            className="inline-flex h-9 items-center gap-2 rounded-[2px] border border-border-strong px-3.5 text-[13px] font-medium text-text transition-colors duration-150 hover:border-text-subtle hover:bg-surface-hover"
          >
            {revealed ? (
              <EyeOff className="size-4" aria-hidden="true" />
            ) : (
              <Eye className="size-4" aria-hidden="true" />
            )}
            {revealed ? "Hide key" : "Reveal key"}
          </button>
        </div>
        <div className="flex h-[42px] items-stretch border-t border-border bg-surface-raised">
          {isLoading ? (
            <div className="flex flex-1 items-center px-3">
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              <code className="flex flex-1 items-center overflow-x-auto px-3 font-mono text-[13px] text-text">
                {apiKey ? (revealed ? apiKey : maskKey(apiKey)) : "—"}
              </code>
              {apiKey ? (
                <button
                  type="button"
                  onClick={onCopy}
                  aria-label={copied ? "Copied" : "Copy project key"}
                  aria-live="polite"
                  className="grid w-10 shrink-0 place-items-center border-l border-border text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text"
                >
                  {copied ? (
                    <Check className="size-4 text-success" aria-hidden="true" />
                  ) : (
                    <Copy className="size-4" aria-hidden="true" />
                  )}
                </button>
              ) : null}
            </>
          )}
        </div>
      </Frame>
    </div>
  );
}
