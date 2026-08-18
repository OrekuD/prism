import { Check, Copy } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";

/**
 * Code-copy row (design-system.md 9.6): `$` prompt, mono command, copy
 * action that flips to a check for 1500ms and announces via an ARIA live
 * region. Never shows real secrets.
 *
 * Multi-line commands render on their own lines and long lines wrap inside
 * the container (pre-wrap + break-words), so nothing overflows the card.
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
        "flex min-h-[42px] min-w-0 items-stretch bg-surface-raised",
        className,
      )}
    >
      <pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words px-3 py-[11px] font-mono text-[13px] leading-[1.5] text-text">
        <span aria-hidden="true" className="mr-2 select-none text-text-subtle">
          {prompt}
        </span>
        {command}
      </pre>
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
