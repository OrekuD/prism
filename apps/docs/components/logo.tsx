/**
 * Prism brand lockup for the docs shell (canonical Task-7 mark).
 * Deliberately NOT an <a>: the Fumadocs layouts wrap `nav.title` in their
 * own link to `nav.url`, so a nested Link here would produce invalid
 * <a><a> markup and a hydration error.
 * The two-tone mark needs a theme-specific variant: the dark variant's
 * off-white upper facet would vanish on light surfaces, so we swap to the
 * light variant in dark mode (class-based Tailwind dark variant).
 */
export function PrismLogo() {
  return (
    <span className="inline-flex items-center gap-2">
      <img src="/prism-logo.png" alt="" aria-hidden className="size-6" />
      <span className="font-semibold tracking-tight text-fd-foreground">
        Prism
      </span>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-fd-muted-foreground border border-fd-border rounded-[2px] px-1.5 py-0.5">
        Docs
      </span>
    </span>
  );
}
