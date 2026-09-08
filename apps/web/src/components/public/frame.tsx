import type React from "react";
import { cn } from "@/lib/utils";

/**
 * Soft card primitive (redesign/web-ui). Former L-shaped corner marks removed —
 * plain 20px rounded card. Kept the same `Frame` / `SectionLabel` API so
 * existing pages keep rendering while we migrate them to the new system.
 */
export function Frame({
  className,
  children,
  label,
  marks,
  inset = false,
  destructive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
  /** Accepted for backwards compat, no longer rendered. */
  marks?: boolean;
  /** Apply the raised surface background. */
  inset?: boolean;
  /** Destructive variant: muted danger border. */
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[20px] border",
        destructive ? "border-danger/30" : "border-border",
        inset ? "bg-surface" : "bg-surface",
        className,
      )}
      {...props}
    >
      {label ? (
        <span className="absolute -top-[9px] left-[18px] bg-surface px-[6px] text-[13px] font-medium tracking-normal text-text-muted">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}

/** Section label: Inter, normal case. */
export function SectionLabel({
  children,
  prefix = null,
  className,
}: {
  children: React.ReactNode;
  prefix?: string | null;
  className?: string;
}) {
  return (
    <p className={cn("text-[13px] font-medium tracking-normal text-text", className)}>
      {prefix ? <span className="mr-1 text-text-subtle">{prefix}</span> : null}
      {children}
    </p>
  );
}
