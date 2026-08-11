import React from "react";

/**
 * PrismMark — the canonical square Prism mark (task-7 section 4).
 *
 * Backed by the master geometry in packages/brand/assets/prism-mark.svg
 * (24x24 grid; two-piece folded-prism silhouette with a diagonal gap).
 * The SVG is always square: equal width/height plus `aspect-ratio: 1 / 1`
 * so flex layouts cannot squash it. Only presentation props are exposed —
 * geometry overrides are intentionally not part of the API.
 */
export type PrismMarkVariant =
  | "dark"
  | "light"
  | "monochrome"
  | "black"
  | "white"
  | "violet";

const UPPER_FILL: Record<PrismMarkVariant, string> = {
  dark: "#F2F2F4",
  light: "#111116",
  monochrome: "currentColor",
  black: "#000000",
  white: "#FFFFFF",
  violet: "#6547E8",
};

const LOWER_FILL: Record<PrismMarkVariant, string> = {
  dark: "#6547E8",
  light: "#6547E8",
  monochrome: "currentColor",
  black: "#000000",
  white: "#FFFFFF",
  violet: "#6547E8",
};

export const PRISM_MARK_PATH_UPPER =
  "M 2.97 14.56 L 18.97 7.06 L 18.97 4.9 L 9.5 9.15 Z";
export const PRISM_MARK_PATH_LOWER =
  "M 3.53 15.74 L 19.53 8.24 L 20.25 6.8 L 4.25 19.9 Z";

export function PrismMark({
  size = 24,
  variant = "dark",
  decorative = false,
  className,
}: {
  /** Rendered width/height in px (the mark is always square). */
  size?: number;
  variant?: PrismMarkVariant;
  /** Decorative use (next to visible text or inside a labeled link). */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      className={className}
      style={{ aspectRatio: "1 / 1", flexShrink: 0 }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Prism"}
      aria-hidden={decorative ? true : undefined}
      data-variant={variant}
    >
      <path d={PRISM_MARK_PATH_UPPER} fill={UPPER_FILL[variant]} />
      <path d={PRISM_MARK_PATH_LOWER} fill={LOWER_FILL[variant]} />
    </svg>
  );
}
