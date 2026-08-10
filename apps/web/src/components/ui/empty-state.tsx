import type React from "react";
import { Frame } from "@/components/public/frame";

/**
 * Empty state (design-system.md 15.2): answers what is empty, why it may
 * be empty, and the one next action. Lives inside the component's normal
 * frame.
 */
export function EmptyState({
  label,
  title,
  description,
  action,
  className,
}: {
  label?: string;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <Frame className={className}>
      <div className="grid place-items-center gap-3 px-6 py-12 text-center">
        {label ? (
          <p className="font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-subtle">
            {label}
          </p>
        ) : null}
        <p className="text-[15px] font-semibold text-text">{title}</p>
        {description ? (
          <p className="max-w-[46ch] text-[13px] leading-relaxed text-text-muted">
            {description}
          </p>
        ) : null}
        {action ? <div className="mt-2">{action}</div> : null}
      </div>
    </Frame>
  );
}
