import React from "react";
import { cn } from "@/lib/utils";
import { PrismMark, type PrismMarkVariant } from "./prism-mark";

/**
 * PrismLogo — horizontal lockup: the unchanged square mark plus a
 * restrained PRISM wordmark (task-7 section 4).
 *
 * The mark keeps its square aspect ratio; the wordmark is separate text,
 * so the lockup never stretches or distorts the mark. When the lockup
 * sits next to other visible text (instance names, headings), pass
 * `decorative` so the whole element is hidden from assistive tech and
 * the surrounding text provides the accessible name.
 */
export function PrismLogo({
  size = 20,
  variant = "dark",
  decorative = false,
  className,
  markClassName,
}: {
  /** Mark size in px (the wordmark scales with it). */
  size?: number;
  variant?: PrismMarkVariant;
  decorative?: boolean;
  className?: string;
  markClassName?: string;
}) {
  return (
    <span
      className={cn("inline-flex items-center gap-[0.45em]", className)}
      aria-hidden={decorative ? true : undefined}
    >
      <PrismMark
        size={size}
        variant={variant}
        decorative
        className={markClassName}
      />
      <span
        className={cn(
          "font-sans font-semibold uppercase leading-none tracking-[0.22em] text-text",
          variant === "dark" && "text-[#F2F2F4]",
          variant === "white" && "text-white",
          variant === "black" && "text-black",
          variant === "monochrome" && "text-current",
        )}
        style={{ fontSize: size * 0.62 }}
      >
        Prism
      </span>
    </span>
  );
}
