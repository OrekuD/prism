/**
 * Overview mode (Task 21 slice 7): Insights, Project pulse, Activity,
 * secondary, and data-quality regions from `ProjectOverviewResource`.
 *
 * Deterministic content only — no model is invoked on overview loads.
 * Every insight and metric with a drill-down is keyboard reachable;
 * skeletons preserve final geometry; successful zeros render only
 * after a successful query.
 */
import { Link } from "react-router-dom";
import type {
  InsightCandidate,
  MetricFact,
  ProjectOverviewResource,
} from "@prism-analytics/types";
import { Frame } from "@/components/public/frame";
import { ArtifactWidget } from "@/components/assistant/artifact-widgets";
import { cn } from "@/lib/utils";

function scopeLine(resource: ProjectOverviewResource): string {
  const context = resource.queryContext;
  const days = Math.round((context.to - context.from) / 86_400_000);
  const date = new Date(context.asOf).toISOString().slice(0, 10);
  return `Last ${days} days · snapshot ${date} · ${resource.capabilities.sources.total} source${resource.capabilities.sources.total === 1 ? "" : "s"}`;
}

function PulseCard({ fact }: { fact: MetricFact }) {
  const comparison = fact.comparison;
  const delta =
    comparison !== null && comparison.kind === "percent"
      ? `${comparison.direction === "up" ? "▲" : comparison.direction === "down" ? "▼" : "■"} ${Math.abs(comparison.percent ?? 0)}%`
      : comparison !== null && comparison.kind === "new"
        ? "new"
        : null;
  return (
    <Frame className="h-[108px] px-[22px] pb-[18px] pt-6">
      <p className="font-mono text-[11px] uppercase tracking-wider text-text-subtle">
        {fact.label}
      </p>
      <p className="mt-1 font-mono text-2xl tabular-nums" aria-label={`${fact.label}: ${fact.formattedValue}`}>
        {fact.value === null ? "—" : fact.formattedValue}
      </p>
      {delta ? (
        <p className="mt-0.5 font-mono text-[11px] text-text-subtle">{delta} vs previous</p>
      ) : null}
    </Frame>
  );
}

function InsightCard({
  insight,
  featured,
  onInvestigate,
}: {
  insight: InsightCandidate;
  featured: boolean;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  const tone =
    insight.severity === "critical"
      ? "border-danger/50"
      : insight.severity === "attention"
        ? "border-warning/50"
        : "border-border";
  return (
    <article
      className={cn(
        "rounded-xl border bg-background p-4",
        tone,
        featured ? "sm:col-span-1" : "",
      )}
      aria-labelledby={`insight-${insight.id}`}
    >
      <p className="font-mono text-[10px] uppercase tracking-wider text-text-subtle">
        {insight.kind} · {insight.severity}
      </p>
      <h3 id={`insight-${insight.id}`} className={cn("mt-1 font-semibold", featured ? "text-lg" : "text-sm")}>
        {insight.title}
      </h3>
      <p className="mt-1 text-sm text-text-subtle">{insight.summary}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onInvestigate(insight)}
          className="rounded-md bg-accent px-3 py-1.5 font-mono text-xs text-white hover:opacity-90"
        >
          Investigate with Prism
        </button>
        <Link
          to={`${insight.drilldown.destination}`}
          className="rounded-md border border-border px-3 py-1.5 font-mono text-xs hover:border-accent"
        >
          {insight.drilldown.label} →
        </Link>
      </div>
    </article>
  );
}

export function OverviewView({
  resource,
  isLoading,
  isError,
  onInvestigate,
}: {
  resource: ProjectOverviewResource | undefined;
  isLoading: boolean;
  isError: boolean;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  if (isLoading) {
    return (
      <div className="grid gap-4" aria-label="Loading project overview">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="h-40 animate-pulse rounded-xl bg-border-subtle/40" />
          <div className="h-40 animate-pulse rounded-xl bg-border-subtle/40" />
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((index) => (
            <div key={index} className="h-[108px] animate-pulse rounded-xl bg-border-subtle/40" />
          ))}
        </div>
        <div className="h-48 animate-pulse rounded-xl bg-border-subtle/40" />
      </div>
    );
  }
  if (isError || !resource) {
    return (
      <div role="alert" className="rounded-xl border border-danger/40 bg-danger/5 p-5">
        <h2 className="font-semibold">Project overview unavailable</h2>
        <p className="mt-1 text-sm text-text-subtle">
          Prism could not load this snapshot. The assistant is also paused until
          the overview loads — try again shortly.
        </p>
      </div>
    );
  }
  const [featured, ...rest] = resource.insights;
  return (
    <div className="grid gap-6">
      <div>
        <h1 className="text-xl font-semibold">Project overview</h1>
        <p className="mt-0.5 font-mono text-xs text-text-subtle">{scopeLine(resource)}</p>
      </div>

      <section aria-labelledby="insights-heading">
        <h2 id="insights-heading" className="mb-2 font-mono text-xs uppercase tracking-wider text-text-subtle">
          Insights
        </h2>
        {resource.insights.length === 0 ? (
          <p className="rounded-xl border border-border p-4 text-sm text-text-subtle">
            No significant changes detected in this range. Coverage and pulse
            below reflect the current snapshot.
          </p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {featured ? (
              <InsightCard insight={featured} featured onInvestigate={onInvestigate} />
            ) : null}
            <div className="grid gap-3">
              {rest.map((insight) => (
                <InsightCard
                  key={insight.id}
                  insight={insight}
                  featured={false}
                  onInvestigate={onInvestigate}
                />
              ))}
            </div>
          </div>
        )}
      </section>

      <section aria-labelledby="pulse-heading">
        <h2 id="pulse-heading" className="mb-2 font-mono text-xs uppercase tracking-wider text-text-subtle">
          Project pulse
        </h2>
        <div className="grid gap-3 sm:grid-cols-3">
          {resource.pulse.map((fact) => (
            <PulseCard key={fact.id} fact={fact} />
          ))}
        </div>
      </section>

      <section aria-labelledby="activity-heading" className="grid gap-3 lg:grid-cols-3">
        <h2 id="activity-heading" className="sr-only">
          Activity
        </h2>
        <div className="lg:col-span-2">
          <ArtifactWidget artifact={resource.activity} />
        </div>
        <div>
          <ArtifactWidget artifact={resource.secondary} />
        </div>
      </section>

      {resource.dataQuality.warnings.length > 0 ||
      resource.dataQuality.definitionState === "missing" ? (
        <section
          aria-label="Data quality"
          className="rounded-xl border border-warning/40 bg-warning/5 p-4"
        >
          <ul className="space-y-1">
            {resource.dataQuality.warnings.map((warning) => (
              <li key={warning} className="font-mono text-xs">
                {warning}
              </li>
            ))}
            {resource.dataQuality.definitionState === "missing" ? (
              <li className="font-mono text-xs">
                No key outcome is defined yet
                {resource.dataQuality.definitionLabel
                  ? ` (${resource.dataQuality.definitionLabel})`
                  : ""}
                . Define one so Prism can answer outcome questions precisely.
              </li>
            ) : null}
          </ul>
        </section>
      ) : null}
    </div>
  );
}
