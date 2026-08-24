import type React from "react";
import { cn } from "@/lib/cn";

/**
 * Registration-marked frame — ported from apps/web/src/components/public/frame.tsx
 * for visual parity with the webapp v2 dashboard primitive.
 * 1px border, 2px radius, four accent L-shaped corner marks.
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
    ? "before:bg-destructive after:bg-destructive"
    : "before:bg-fd-primary after:bg-fd-primary";
  return (
    <span
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute",
        x === "left" ? "-left-px" : "-right-px",
        y === "top" ? "-top-px" : "-bottom-px",
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
  marks?: boolean;
  inset?: boolean;
  destructive?: boolean;
}) {
  return (
    <div
      className={cn(
        "relative rounded-[2px] border",
        destructive ? "border-destructive/30" : "border-fd-border",
        inset && "bg-fd-card",
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
        <span className="absolute -top-[7px] left-[14px] bg-fd-background px-[5px] font-mono text-[10px] font-medium uppercase tracking-[0.09em] text-fd-muted-foreground">
          {label}
        </span>
      ) : null}
      {children}
    </div>
  );
}
