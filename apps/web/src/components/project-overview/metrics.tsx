/**
 * Project health metric cards. Each card binds one canonical pulse fact:
 * the exact formatted value, a trend badge from the fact's own
 * comparison (flat/`new`/missing comparisons render honestly), and a
 * sparkline only when a real series backs the metric (the canonical
 * accepted-events activity series) — never synthesized curves.
 */
import type { MetricFact } from "@prism-analytics/types";
import { MkFrame, SectionLabel } from "@/components/project-overview/primitives";
import { sparkPath } from "@/components/project-overview/chart-math";
import { cn } from "@/lib/utils";

function TrendBadge({ fact }: { fact: MetricFact }) {
  const comparison = fact.comparison;
  if (comparison === null)
    return <span className="trend font-mono text-[10px] text-text-muted">—</span>;
  if (comparison.kind === "new")
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-success">
        new
      </span>
    );
  if (comparison.kind === "no-prior-data")
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-text-muted">
        no prior data
      </span>
    );
  const percent = Math.abs(comparison.percent ?? 0);
  if (comparison.direction === "flat")
    return (
      <span className="inline-flex items-center gap-0.5 font-mono text-[10px] text-text-muted">
        <span aria-hidden="true">—</span>
        <span>{percent}%</span>
      </span>
    );
  const down = comparison.direction === "down";
  return (
    <span
      className={cn(
        "inline-flex items-center gap-0.5 font-mono text-[10px]",
        down ? "text-danger" : "text-success",
      )}
    >
      <svg
        viewBox="0 0 12 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.4"
        aria-hidden="true"
        className="h-3 w-3"
      >
        <path d="M3 8l3-4 3 4" />
      </svg>
      <span>{percent}%</span>
    </span>
  );
}

function Sparkline({
  points,
  tone,
  label,
}: {
  points: readonly number[];
  tone: "text" | "danger" | "success";
  label: string;
}) {
  const color =
    tone === "danger"
      ? "var(--danger)"
      : tone === "success"
        ? "var(--success)"
        : "var(--text)";
  return (
    <svg
      viewBox="0 0 100 25"
      preserveAspectRatio="none"
      aria-hidden="true"
      role="presentation"
      className="mt-auto block h-[22px] w-full pt-2"
    >
      <title>{label}</title>
      <path
        d={sparkPath(points, 100, 25)}
        fill="none"
        stroke={color}
        strokeWidth="1.6"
      />
    </svg>
  );
}

export function MetricCard({
  fact,
  spark,
}: {
  fact: MetricFact;
  spark?: { points: readonly number[]; tone: "text" | "danger" | "success" };
}) {
  return (
    <MkFrame className="flex min-h-[108px] flex-col bg-surface p-[16px_12px_12px]">
      <div className="flex items-center justify-between gap-2">
        <span
          className="whitespace-nowrap font-mono text-xl tracking-[-0.05em] text-text tabular-nums"
          aria-label={`${fact.label}: ${fact.formattedValue}`}
        >
          {fact.value === null ? "—" : fact.formattedValue}
        </span>
        <TrendBadge fact={fact} />
      </div>
      <span className="mt-1.5 block font-mono text-[10px] font-medium uppercase leading-[1.2] tracking-[0.04em] text-text-muted">
        {fact.label}
      </span>
      {spark ? (
        <Sparkline points={spark.points} tone={spark.tone} label={`${fact.label} trend`} />
      ) : null}
    </MkFrame>
  );
}

export function MetricGrid({
  facts,
  sparkFor,
  rangeLabel,
}: {
  facts: readonly MetricFact[];
  sparkFor: (fact: MetricFact) => { points: readonly number[]; tone: "text" | "danger" | "success" } | undefined;
  rangeLabel: string;
}) {
  return (
    <>
      <SectionLabel right={rangeLabel}>Project health</SectionLabel>
      <div className="grid grid-cols-3 gap-2.5 max-[760px]:grid-cols-2 max-[520px]:grid-cols-1">
        {facts.map((fact) => (
          <MetricCard key={fact.id} fact={fact} spark={sparkFor(fact)} />
        ))}
      </div>
    </>
  );
}
