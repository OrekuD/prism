import type React from "react";
import { cn } from "@/lib/utils";

/**
 * Registration-marked frame (design-system.md 8.2).
 * 1px border, 2px radius, four 5x5 corner squares centered over the
 * corners. Marks are pointer-events: none and hidden from assistive tech.
 */
export function Frame({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn("relative border border-border", className)} {...props}>
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -left-[3px] -top-[3px] size-[5px] border border-border-strong bg-canvas"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -right-[3px] -top-[3px] size-[5px] border border-border-strong bg-canvas"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[3px] -left-[3px] size-[5px] border border-border-strong bg-canvas"
      />
      <span
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-[3px] -right-[3px] size-[5px] border border-border-strong bg-canvas"
      />
      {children}
    </div>
  );
}

/** Section label (design-system.md 9.7): 11px mono uppercase, optional //. */
export function SectionLabel({
  children,
  prefix = "//",
  className,
}: {
  children: React.ReactNode;
  prefix?: string | null;
  className?: string;
}) {
  return (
    <p
      className={cn(
        "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text-muted",
        className,
      )}
    >
      {prefix ? (
        <span className="mr-1 text-text-subtle">{prefix}</span>
      ) : null}
      {children}
    </p>
  );
}
