/**
 * Ask Prism composer dock. Design-mock visuals (blurred dock, `Ask Prism`
 * frame label, ⌘K hint, arrow send button, suggestion row) with the
 * production behavior: auto-growing textarea, Enter to send,
 * suggestions fill without submitting, Stop replaces send while a run
 * is active, drafts survive remounts via the parent.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { Square } from "lucide-react";
import type { ProjectCapabilities } from "@prism-analytics/types";
import { Kbd } from "@/components/project-overview/primitives";
import { cn } from "@/lib/utils";

export type ComposerDockHandle = {
  focus: () => void;
};

function suggestionsFor(capabilities: ProjectCapabilities | null): string[] {
  if (!capabilities)
    return ["What changed this week?", "Why did errors increase?"];
  const suggestions: string[] = ["What changed this week?"];
  if (
    capabilities.errorCollection.configured ||
    capabilities.errorCollection.observed
  ) {
    suggestions.push("Why did errors increase?");
  }
  if (capabilities.standardEventsObserved.length > 0) {
    suggestions.push("How many new signups were recorded yesterday?");
  } else {
    suggestions.push("What does this project track?");
  }
  return suggestions.slice(0, 3);
}

export const ComposerDock = forwardRef<
  ComposerDockHandle,
  {
    draft: string;
    onDraftChange: (draft: string) => void;
    onSubmit: (question: string) => void;
    running: boolean;
    onStop: () => void;
    capabilities: ProjectCapabilities | null;
    disabled?: boolean;
    disabledReason?: string;
  }
>(function ComposerDock(
  {
    draft,
    onDraftChange,
    onSubmit,
    running,
    onStop,
    capabilities,
    disabled,
    disabledReason,
  },
  ref,
) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  useImperativeHandle(ref, () => ({
    focus: () => inputRef.current?.focus(),
  }));

  const submit = useCallback(() => {
    const question = draft.trim();
    if (!question || running || disabled) return;
    onSubmit(question);
  }, [draft, running, disabled, onSubmit]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const modalOpen = document.querySelector('[role="dialog"]');
        const target = event.target as HTMLElement | null;
        const inEditable =
          target !== null &&
          (target.tagName === "INPUT" ||
            target.tagName === "TEXTAREA" ||
            target.isContentEditable);
        if (!modalOpen && !inEditable) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // biome-ignore lint/correctness/useExhaustiveDependencies: the effect must re-fit after every draft render
  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 132)}px`;
  }, [draft]);

  const suggestions = suggestionsFor(capabilities);

  return (
    <div className="sticky bottom-0 z-[25] mt-6 px-0 pb-5 pt-6">
      <div
        aria-hidden="true"
        className="po-composer-fade pointer-events-none absolute -left-8 -right-8 top-0 h-12 max-[760px]:-left-[18px] max-[760px]:-right-[18px]"
      />
      <div className="po-mk relative rounded-sm border border-border bg-surface/90 p-[14px_12px_12px] shadow-[0_-8px_32px_rgb(0_0_0/0.24),inset_0_1px_0_var(--border)] backdrop-blur-2xl">
        <span className="absolute -top-[7px] left-[14px] bg-canvas px-[5px] font-mono text-[10px] font-medium uppercase leading-none tracking-[0.09em] text-text-muted">
          Ask Prism
        </span>
        <form
          className="flex items-end gap-2.5"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="flex min-h-11 flex-1 items-end gap-2.5 rounded-sm border border-border-strong bg-surface px-[14px] py-2 transition-colors duration-100 focus-within:border-accent">
            <label htmlFor="ask-prism-input" className="sr-only">
              Ask Prism a question
            </label>
            <textarea
              id="ask-prism-input"
              ref={inputRef}
              value={draft}
              onChange={(event) =>
                onDraftChange(event.target.value.slice(0, 2000))
              }
              onKeyDown={(event) => {
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={1}
              maxLength={2000}
              autoComplete="off"
              placeholder={
                disabled
                  ? (disabledReason ?? "Assistant unavailable")
                  : "Ask a question about this project…"
              }
              disabled={disabled && !running}
              className="max-h-[132px] min-h-[1lh] flex-1 resize-none overflow-hidden bg-transparent p-[2px_0] text-sm leading-[1.5] text-text outline-none placeholder:text-text-subtle disabled:opacity-60"
            />
            <Kbd>⌘K</Kbd>
          </div>
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the running answer"
              className="inline-flex h-11 w-11 flex-none items-center justify-center rounded-sm bg-danger text-white transition-opacity hover:opacity-90"
            >
              <Square aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send question"
              disabled={draft.trim().length === 0 || disabled}
              className={cn(
                "inline-flex h-11 w-11 flex-none items-center justify-center rounded-sm bg-accent text-white shadow-[inset_0_1px_0_rgb(0_0_0/0.12),0_2px_8px_color-mix(in_oklab,var(--accent)_22%,transparent)] transition-all duration-100 hover:bg-accent-hover active:translate-y-px active:bg-accent-active active:shadow-none disabled:opacity-45",
                "[&_svg]:h-4 [&_svg]:w-4",
              )}
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
              >
                <path d="M2.5 8h10M9 4.5 12.5 8 9 11.5" />
              </svg>
            </button>
          )}
        </form>
        <ul
          aria-label="Suggested questions"
          className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3"
        >
          {suggestions.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => {
                  onDraftChange(suggestion);
                  inputRef.current?.focus();
                }}
                className="inline-flex h-7 items-center rounded-sm border border-border px-3 font-mono text-xs font-normal text-text-muted transition-colors duration-100 hover:border-border-strong hover:bg-surface-hover hover:text-text"
              >
                {suggestion}
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
});
