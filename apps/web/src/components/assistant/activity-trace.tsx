/**
 * Activity trace (Task 21 slice 7): "How I answered" without hidden
 * model deliberation. Friendly operation names only — never internal
 * tool IDs, inputs, JSON, or reasoning tokens. Each step exposes its
 * pending/running/complete/failed text in addition to icons.
 */
import { useState } from "react";
import { Check, Loader2, X } from "lucide-react";
import type { ActivityStep } from "@prism-analytics/types";
import { cn } from "@/lib/utils";

function StepIcon({ state }: { state: ActivityStep["state"] }) {
  if (state === "complete") {
    return <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />;
  }
  if (state === "failed") {
    return <X className="h-3.5 w-3.5 text-danger" aria-hidden="true" />;
  }
  return (
    <Loader2 className="h-3.5 w-3.5 animate-spin text-accent" aria-hidden="true" />
  );
}

const STATE_TEXT: Record<ActivityStep["state"], string> = {
  pending: "pending",
  running: "running",
  complete: "complete",
  failed: "failed",
};

export function ActivityTrace({
  steps,
  collapsed = false,
}: {
  steps: ActivityStep[];
  collapsed?: boolean;
}) {
  const [open, setOpen] = useState(!collapsed);
  if (steps.length === 0) return null;
  const running = steps.some((step) => step.state === "running");
  return (
    <div className="rounded-lg border border-border-subtle px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between font-mono text-xs text-text-subtle hover:text-text"
      >
        <span>
          How I answered
          {running ? (
            <span className="ml-2 text-accent">· working…</span>
          ) : (
            <span className="ml-2">· {steps.length} steps</span>
          )}
        </span>
        <span aria-hidden="true">{open ? "−" : "+"}</span>
      </button>
      {open ? (
        <ol className="mt-2 space-y-1.5" aria-live="off">
          {steps.map((step) => (
            <li
              key={step.stepId}
              className="flex items-center gap-2 font-mono text-xs"
            >
              <StepIcon state={step.state} />
              <span className="truncate">{step.label}</span>
              <span className={cn("ml-auto shrink-0 text-[10px]", step.state === "failed" ? "text-danger" : "text-text-subtle")}>
                {STATE_TEXT[step.state]}
              </span>
            </li>
          ))}
        </ol>
      ) : null}
    </div>
  );
}
