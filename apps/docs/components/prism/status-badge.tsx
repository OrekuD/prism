import { cn } from '@/lib/cn';

type Tone = 'stable' | 'experimental' | 'planned';

const LABEL: Record<Tone, string> = {
  stable: 'Stable',
  experimental: 'Experimental',
  planned: 'Planned',
};

const TONE_CLASS: Record<Tone, string> = {
  stable: 'text-fd-success border-fd-success/40',
  experimental: 'text-fd-warning border-fd-warning/40',
  planned: 'text-fd-info border-fd-info/40',
};

/** Availability status badge; status must come from a documented source. */
export function StatusBadge({
  tone,
  className,
}: {
  tone: Tone;
  className?: string;
}) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-[2px] border px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-[0.08em]',
        TONE_CLASS[tone],
        className,
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {LABEL[tone]}
    </span>
  );
}
