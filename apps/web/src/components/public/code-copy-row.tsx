import { Check, Copy } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

/**
 * Code-copy row (design-system.md 9.6): `$` prompt, mono command, copy
 * action that flips to a check for 1500ms and announces via an ARIA live
 * region. Never shows real secrets.
 */
export function CodeCopyRow({
  command,
  prompt = "$",
  className,
}: {
  command: string;
  prompt?: string;
  className?: string;
}) {
  const [copied, setCopied] = React.useState(false);

  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable (permissions, http): leave the row as-is.
    }
  };

  return (
    <div
      className={cn(
        "flex h-[42px] min-w-0 items-stretch bg-surface-raised",
        className,
      )}
    >
      <code className="flex min-w-0 flex-1 items-center gap-2 overflow-x-auto px-3 font-mono text-[13px] text-text">
        <span aria-hidden="true" className="select-none text-text-subtle">
          {prompt}
        </span>
        <span className="whitespace-nowrap">{command}</span>
      </code>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy command"}
        aria-live="polite"
        className="grid w-9 shrink-0 place-items-center border-l border-border text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus"
      >
        {copied ? (
          <Check className="size-4 text-success" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
