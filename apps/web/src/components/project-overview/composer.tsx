/** Persistent composer for the overview and its conversations. */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";
import { ChevronDown, Sparkles, Square } from "@/components/ui/hugeicons";
import type { ProjectCapabilities } from "@prism-analytics/types";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

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
    showSuggestions?: boolean;
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
    showSuggestions = false,
  },
  ref,
) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const focusAfterSuggestion = useRef(false);
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
    <form
      aria-label="Ask Prism"
      className="pointer-events-auto mx-auto flex w-full max-w-[760px] flex-col gap-2 rounded-2xl border border-border bg-surface-raised p-3 transition-colors duration-150 focus-within:border-focus"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <label htmlFor="ask-prism-input" className="sr-only">
        Ask Prism a question
      </label>
      <textarea
        id="ask-prism-input"
        ref={inputRef}
        value={draft}
        onChange={(event) => onDraftChange(event.target.value.slice(0, 2000))}
        onKeyDown={(event) => {
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
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
        className="max-h-[132px] min-h-10 w-full resize-none overflow-y-auto bg-transparent px-1 py-1 text-base leading-6 text-text outline-none placeholder:text-text-muted disabled:opacity-60 sm:text-sm"
      />
      <div className="flex items-center justify-between gap-3">
        {showSuggestions ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                type="button"
                disabled={disabled || running}
                className="-ml-1 inline-flex h-10 items-center gap-1.5 rounded-[10px] px-2 text-xs text-text-muted transition-colors duration-150 hover:bg-surface-hover hover:text-text focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:opacity-45 sm:h-9"
              >
                <Sparkles aria-hidden="true" className="size-4" />
                Suggestions
                <ChevronDown aria-hidden="true" className="size-3" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              side="top"
              sideOffset={12}
              className="max-w-[calc(100vw-2rem)] rounded-xl p-1.5"
              onCloseAutoFocus={(event) => {
                if (!focusAfterSuggestion.current) return;
                event.preventDefault();
                focusAfterSuggestion.current = false;
                inputRef.current?.focus();
              }}
            >
              {suggestions.map((suggestion) => (
                <DropdownMenuItem
                  key={suggestion}
                  className="min-h-10 rounded-lg px-3 py-2 text-[13px]"
                  onSelect={() => {
                    onDraftChange(suggestion);
                    focusAfterSuggestion.current = true;
                  }}
                >
                  {suggestion}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <span className="inline-flex h-9 items-center gap-1.5 px-1 text-xs text-text-muted">
            <Sparkles aria-hidden="true" className="size-4" />
            Ask Prism
          </span>
        )}
        <div className="flex items-center gap-2">
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the running answer"
              className="inline-flex size-10 flex-none items-center justify-center rounded-[10px] bg-accent text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:size-9"
            >
              <Square aria-hidden="true" className="h-4 w-4" />
            </button>
          ) : (
            <button
              type="submit"
              aria-label="Send question"
              disabled={draft.trim().length === 0 || disabled}
              className="inline-flex size-10 flex-none items-center justify-center rounded-[10px] bg-accent text-primary-foreground transition-colors duration-150 hover:bg-accent-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus disabled:bg-surface-hover disabled:text-text-subtle sm:size-9"
            >
              <svg
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.6"
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden="true"
                className="size-[18px]"
              >
                <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" />
              </svg>
            </button>
          )}
        </div>
      </div>
    </form>
  );
});
