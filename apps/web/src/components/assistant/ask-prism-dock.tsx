/**
 * Persistent Ask Prism dock (Task 21 slice 7).
 *
 * Mounted once beneath Overview and Conversation views so draft text,
 * focus, and height survive mode changes. Enter submits, Shift+Enter
 * adds a newline; Cmd/Ctrl+K focuses the input; suggestions fill the
 * input without submitting; submission is disabled while this member
 * has an active run, with a visible Stop action.
 */
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { ArrowUp, Square } from "lucide-react";
import type { ProjectCapabilities } from "@prism-analytics/types";
import { cn } from "@/lib/utils";

export type AskPrismDockHandle = {
  focus: () => void;
};

function suggestionsFor(capabilities: ProjectCapabilities | null): string[] {
  if (!capabilities) return ["What changed this week?"];
  const suggestions: string[] = [];
  if (capabilities.standardEventsObserved.length > 0) {
    suggestions.push("How many new signups have we had since yesterday?");
  } else {
    suggestions.push("What does this project track?");
  }
  if (capabilities.web) suggestions.push("Which pages have the most views?");
  if (capabilities.mobile) suggestions.push("Which screens do people use most?");
  if (capabilities.errorCollection.configured || capabilities.errorCollection.observed) {
    suggestions.push("What are the largest unresolved errors?");
  }
  suggestions.push("What changed this week?");
  return suggestions.slice(0, 4);
}

export const AskPrismDock = forwardRef<
  AskPrismDockHandle,
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
>(function AskPrismDock(
  { draft, onDraftChange, onSubmit, running, onStop, capabilities, disabled, disabledReason },
  ref,
) {
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [focused, setFocused] = useState(false);
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
      const target = event.target as HTMLElement | null;
      const inEditable =
        target !== null &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        const modalOpen = document.querySelector('[role="dialog"]');
        if (!modalOpen && !inEditable) {
          event.preventDefault();
          inputRef.current?.focus();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    const textarea = inputRef.current;
    if (!textarea) return;
    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 160)}px`;
  }, [draft]);

  const suggestions = suggestionsFor(capabilities);

  return (
    <div className="sticky bottom-0 z-10 -mx-1 px-1 pb-3 pt-6">
      <div className="pointer-events-none absolute inset-x-0 top-0 h-6 bg-gradient-to-t from-background to-transparent" aria-hidden="true" />
      <div className="relative rounded-xl border border-border bg-background/95 shadow-lg backdrop-blur">
        {!focused && draft.length === 0 ? (
          <ul className="flex gap-2 overflow-x-auto px-3 pt-2.5" aria-label="Suggested questions">
            {suggestions.map((suggestion) => (
              <li key={suggestion} className="shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    onDraftChange(suggestion);
                    inputRef.current?.focus();
                  }}
                  className="shrink-0 rounded-full border border-border-subtle px-3 py-1 font-mono text-[11px] text-text-subtle transition-colors hover:border-accent hover:text-text"
                >
                  {suggestion}
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="flex items-end gap-2 p-2.5">
          <label htmlFor="ask-prism-input" className="sr-only">
            Ask Prism about this project
          </label>
          <textarea
            id="ask-prism-input"
            ref={inputRef}
            value={draft}
            onChange={(event) => onDraftChange(event.target.value.slice(0, 2000))}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                submit();
              }
            }}
            rows={1}
            maxLength={2000}
            placeholder={
              disabled ? (disabledReason ?? "Assistant unavailable") : "Ask Prism about this project…"
            }
            disabled={disabled && !running}
            aria-describedby="ask-prism-hint"
            className="max-h-40 min-h-[36px] flex-1 resize-none rounded-lg bg-transparent px-2 py-1.5 text-sm outline-none placeholder:text-text-subtle disabled:opacity-60"
          />
          {running ? (
            <button
              type="button"
              onClick={onStop}
              aria-label="Stop the running answer"
              className="mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-danger text-white transition-opacity hover:opacity-90"
            >
              <Square className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          ) : (
            <button
              type="button"
              onClick={submit}
              disabled={draft.trim().length === 0 || disabled}
              aria-label="Send question to Prism"
              className={cn(
                "mb-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-opacity",
                draft.trim().length === 0 || disabled
                  ? "bg-border-subtle text-text-subtle"
                  : "bg-accent text-white hover:opacity-90",
              )}
            >
              <ArrowUp className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>
        <p id="ask-prism-hint" className="sr-only">
          Enter sends. Shift Enter adds a new line. Command K focuses this input.
        </p>
      </div>
    </div>
  );
});
