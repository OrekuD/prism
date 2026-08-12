import React from "react";

/**
 * PrismMark — the canonical square Prism logo (task-7 section 4; updated
 * to the new prism-logo.png asset).
 *
 * Backed by the canonical PNG in packages/brand/assets/prism-logo.png
 * (the master logo asset; the export pipeline derives every icon size
 * from it). Rendered as an <img> — always square: equal width/height plus
 * `aspect-ratio: 1 / 1` so flex layouts cannot squash it. Only
 * presentation props are exposed — the artwork is not overridable.
 */
export type PrismMarkVariant =
  | "dark"
  | "light"
  | "monochrome"
  | "black"
  | "white"
  | "violet";

export function PrismMark({
  size = 24,
  variant = "dark",
  decorative = false,
  className,
}: {
  /** Rendered width/height in px (the mark is always square). */
  size?: number;
  /**
   * Accepted for API compatibility; the canonical logo PNG is a fixed
   * two-tone artwork, so every variant renders the same asset.
   */
  variant?: PrismMarkVariant;
  /** Decorative use (next to visible text or inside a labeled link). */
  decorative?: boolean;
  className?: string;
}) {
  return (
    <img
      src="/prism-logo.png"
      width={size}
      height={size}
      alt={decorative ? "" : "Prism"}
      className={className}
      style={{ aspectRatio: "1 / 1", flexShrink: 0, objectFit: "contain" }}
      role={decorative ? undefined : "img"}
      aria-label={decorative ? undefined : "Prism"}
      aria-hidden={decorative ? true : undefined}
      data-variant={variant}
    />
  );
}
