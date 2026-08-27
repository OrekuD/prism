import { Check, Copy } from "lucide-react";
import React from "react";
import { cn } from "@/lib/utils";
import { useCopy } from "@/components/ui/copy-button";

/**
 * Code-copy row with shiki highlighting (design-system.md 9.6): `$` prompt
 * for shell, mono command, copy action that flips to a check for 1500ms.
 * Long lines wrap inside the container (pre-wrap + break-words).
 * Themed like an editor via shiki (github-dark).
 */
export function CodeCopyRow({
  command,
  prompt = "$",
  language,
  className,
}: {
  command: string;
  prompt?: string;
  language?: string;
  className?: string;
}) {
  const { copied, onCopy } = useCopy(command);
  const [html, setHtml] = React.useState<string | null>(null);

  const lang =
    language ??
    (command.trim().startsWith("yarn") ||
    command.trim().startsWith("npm") ||
    command.trim().startsWith("pnpm") ||
    command.trim().startsWith("$")
      ? "bash"
      : "typescript");

  const showPrompt = lang === "bash" && prompt !== "";

  React.useEffect(() => {
    let cancelled = false;
    import("shiki")
      .then(({ codeToHtml }) =>
        codeToHtml(command, {
          lang,
          theme: "github-dark",
        }),
      )
      .then((out) => {
        if (!cancelled) setHtml(out);
      })
      .catch(() => {
        // fallback to plain text on error
        if (!cancelled) setHtml(null);
      });
    return () => {
      cancelled = true;
    };
  }, [command, lang]);

  return (
    <div
      className={cn(
        "flex min-h-[42px] min-w-0 items-stretch overflow-hidden rounded-[2px] border border-border bg-[#0d1117]",
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-stretch">
        {showPrompt ? (
          <span
            aria-hidden="true"
            className="flex select-none items-start bg-[#0d1117] px-3 py-[11px] font-mono text-[13px] leading-[1.5] text-white/40"
          >
            {prompt}
          </span>
        ) : null}
        {html ? (
          <div
            className="min-w-0 flex-1 overflow-hidden py-[11px] pl-3 pr-3 font-mono text-[13px] leading-[1.5] [&_pre]:!m-0 [&_pre]:!bg-transparent [&_pre]:p-0 [&_pre]:whitespace-pre-wrap [&_pre]:break-words [&_code]:!bg-transparent"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: shiki HTML is trusted — generated from static code strings
            dangerouslySetInnerHTML={{ __html: html }}
          />
        ) : (
          <pre className="m-0 min-w-0 flex-1 whitespace-pre-wrap break-words bg-transparent px-3 py-[11px] font-mono text-[13px] leading-[1.5] text-[#e6edf3]">
            {command}
          </pre>
        )}
      </div>
      <button
        type="button"
        onClick={onCopy}
        aria-label={copied ? "Copied" : "Copy command"}
        aria-live="polite"
        className="grid w-9 shrink-0 place-items-center border-l border-white/10 bg-[#0d1117] text-white/60 transition-colors duration-150 hover:bg-white/[0.06] hover:text-white focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-white"
      >
        {copied ? (
          <Check className="size-4 text-[#3fb950]" aria-hidden="true" />
        ) : (
          <Copy className="size-4" aria-hidden="true" />
        )}
      </button>
    </div>
  );
}
