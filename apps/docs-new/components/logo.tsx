import Link from 'next/link';

/**
 * Prism brand lockup for the docs shell (canonical Task-7 mark).
 * The two-tone mark needs a theme-specific variant: the dark variant's
 * off-white upper facet would vanish on light surfaces, so we swap to the
 * light variant in dark mode (class-based Tailwind dark variant).
 */
export function PrismLogo() {
  return (
    <Link
      href="/"
      aria-label="Prism Docs home"
      className="inline-flex items-center gap-2 -m-2 p-2 rounded-[2px]"
    >
      <img src="/prism-mark.svg" alt="" aria-hidden className="size-6 dark:hidden" />
      <img
        src="/prism-mark-light.svg"
        alt=""
        aria-hidden
        className="hidden size-6 dark:block"
      />
      <span className="font-semibold tracking-tight text-fd-foreground">
        Prism
      </span>
      <span className="font-mono text-[10px] font-medium uppercase tracking-[0.08em] text-fd-muted-foreground border border-fd-border rounded-[2px] px-1.5 py-0.5">
        Docs
      </span>
    </Link>
  );
}
