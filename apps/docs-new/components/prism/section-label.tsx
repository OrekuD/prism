import { cn } from '@/lib/cn';

/** Prism `//` section-label voice (design-system §9.7). */
export function SectionLabel({
  label,
  className,
}: {
  label: string;
  className?: string;
}) {
  return (
    <p
      className={cn(
        'font-mono text-[11px] font-medium uppercase tracking-[0.09em] text-fd-muted-foreground',
        className,
      )}
    >
      <span aria-hidden className="text-fd-muted-foreground/60">
        {'//'}
      </span>
      &nbsp;{label}
    </p>
  );
}
