import type React from "react";
import { cn } from "@/lib/utils";

/**
 * Registration-marked frame (v2 dashboard primitive), expressed directly
 * in Tailwind: 1px border, 2px radius, four accent L-shaped corner marks.
 * Renders on every page (including public landing/auth).
 *
 * An optional `label` renders the v2 `.frame-label` eyebrow, and `inset`
 * applies the raised surface background.
 */
function CornerL({
  x,
  y,
  danger = false,
}: {
  x: "left" | "right";
  y: "top" | "bottom";
  danger?: boolean;
}) {
  const arm = danger
    ? "before:bg-danger after:bg-danger"
    : "before:bg-accent after:bg-accent";
  return (
    <span
      aria-hidden="true"
      className={cn(
        // Offset by -1px so the L straddles the frame's 1px border (it sits
        // ON the border, half outside / half inside), matching the v2 .mk.
        "pointer-events-none absolute",
        x === "left" ? "-left-px" : "-right-px",
        y === "top" ? "-top-px" : "-bottom-px",
        // horizontal + vertical arms meet at the frame corner
        "before:absolute before:block before:h-px before:w-[6px]",
        "after:absolute after:block after:h-[6px] after:w-px",
        arm,
        x === "left" ? "before:left-0 after:left-0" : "before:right-0 after:right-0",
        y === "top" ? "before:top-0 after:top-0" : "before:bottom-0 after:bottom-0",
      )}
    />
  );
}

export function Frame({
  className,
  children,
  label,
  marks = true,
  inset = false,
  destructive = false,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  label?: string;
  /** Render the four L-shaped corner marks (default true). */
  marks?: boolean;
  /** Apply the raised surface background. */
  inset?: boolean;
  /** Destructive variant: danger L-marks + a muted danger border. */
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[2px] border",
        destructive ? "border-danger/30" : "border-border",
        inset && "bg-surface",
        className,
      )}
      {...props}
    >
      {marks ? (
        <>
          <CornerL x="left" y="top" danger={destructive} />
          <CornerL x="right" y="top" danger={destructive} />
          <CornerL x="left" y="bottom" danger={destructive} />
          <CornerL x="right" y="bottom" danger={destructive} />
        </>
      ) : null}
      {label ? (
        <span className="absolute -top-[7px] left-[14px] bg-canvas px-[5px] font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-text-muted">
          {label}
        </span>
      ) : null}
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
        "font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-text",
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
