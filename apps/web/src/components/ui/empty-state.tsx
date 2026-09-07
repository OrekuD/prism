import type React from "react";
import { Frame } from "@/components/public/frame";
import { cn } from "@/lib/utils";

/**
 * Consolidated empty state (events + errors + people + analytics).
 * Single Frame, centered, with optional icon/label, 14px title, 12.5px mono
 * description, and action slot. Keeps the glint/values of the previous
 * variants but normalizes spacing and typography.
 */
export function EmptyState({
  label,
  icon,
  title,
  description,
  action,
  className,
}: {
  label?: string;
  icon?: React.ReactNode;
  title: string;
  description?: string | React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Frame className={cn("p-8 text-center", className)} marks={false}>
      <div className="mx-auto flex max-w-[420px] flex-col items-center">
        {icon ? (
          <span className="grid size-9 place-items-center rounded-[2px] border border-border bg-surface text-text-subtle">
            {icon}
          </span>
        ) : null}
        {label && !icon ? (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-subtle">
            {label}
          </p>
        ) : null}
        {/* h2: empty states sit directly under the page h1 — an h3 here
            breaks heading order everywhere this component is used. */}
        <h2 className={cn("font-sans text-[14px] font-medium leading-none tracking-[-0.01em] text-text", (icon || label) && "mt-3")}>
          {title}
        </h2>
        {description ? (
          typeof description === "string" ? (
            <p className="mt-1.5 text-pretty font-mono text-[12.5px] leading-[1.5] text-text-muted">
              {description}
            </p>
          ) : (
            <div className="mt-1.5 text-pretty font-mono text-[12.5px] leading-[1.5] text-text-muted">
              {description}
            </div>
          )
        ) : null}
        {action ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{action}</div> : null}
      </div>
    </Frame>
  );
}
