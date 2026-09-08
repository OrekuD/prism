/**
 * Insights region: featured significant signal, secondary signals, and
 * the data-quality strip. Binds real `InsightCandidate` values to the
 * design mock's compact grid — severity selects the tag tone, a
 * timeseries artifact (when present) draws the mini chart, and the
 * data-quality strip names the first warning plus any missing
 * definition. Nothing renders from placeholder copy.
 */
import { Link } from "react-router-dom";
import type {
  AssistantArtifact,
  InsightCandidate,
} from "@prism-analytics/types";
import { Btn, OverflowButton, SectionLabel, Tag } from "@/components/project-overview/primitives";
import { Frame } from "@/components/public/frame";
import { sparkPath } from "@/components/project-overview/chart-math";
import { cn } from "@/lib/utils";

function severityTag(insight: InsightCandidate): {
  tone: "err" | "warn" | "info" | "ok" | "neu" | "vio";
  text: string;
} {
  if (insight.severity === "critical")
    return { tone: "err", text: "NEEDS ATTENTION" };
  if (insight.severity === "attention")
    return { tone: "warn", text: "WORTH A LOOK" };
  if (insight.kind === "coverage") return { tone: "neu", text: "COVERAGE" };
  if (insight.kind === "definition")
    return { tone: "vio", text: "DEFINITION" };
  if (insight.kind === "release") return { tone: "neu", text: "RELEASE" };
  if (insight.kind === "error") return { tone: "err", text: "ERRORS" };
  return { tone: "ok", text: "SIGNIFICANT CHANGE" };
}

function timeseriesPoints(
  artifact: AssistantArtifact,
): readonly number[] | null {
  if (artifact.kind !== "timeseries") return null;
  const series = artifact.series[0];
  if (!series || series.points.length < 2) return null;
  return series.points.map((point) => point.value);
}

function MiniChart({
  artifact,
  tone,
  className,
}: {
  artifact: AssistantArtifact;
  tone: "err" | "ok";
  className?: string;
}) {
  const points = timeseriesPoints(artifact);
  if (!points) return null;
  const color = tone === "err" ? "var(--danger)" : "var(--success)";
  return (
    <div className={cn("mt-3", className)} aria-hidden="true">
      <svg viewBox="0 0 300 64" preserveAspectRatio="none" className="block h-12 w-full">
        <title>Insight trend</title>
        <path
          d={sparkPath(points, 300, 48)}
          fill="none"
          stroke={color}
          strokeWidth="1.7"
          strokeLinejoin="round"
          strokeLinecap="round"
        />
      </svg>
    </div>
  );
}

function SideSpark({ artifact }: { artifact: AssistantArtifact }) {
  const points = timeseriesPoints(artifact);
  if (!points) return null;
  return (
    <svg
      viewBox="0 0 96 28"
      preserveAspectRatio="none"
      aria-hidden="true"
      className="absolute right-3.5 top-4 h-6 w-[88px] opacity-85"
    >
      <title>Insight trend</title>
      <path
        d={sparkPath(points, 96, 24)}
        fill="none"
        stroke="var(--success)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function InsightActions({
  insight,
  primary,
  onInvestigate,
}: {
  insight: InsightCandidate;
  primary: boolean;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  return (
    <div className="mt-3 flex items-center gap-2">
      {primary ? (
        <Btn variant="primary" onClick={() => onInvestigate(insight)}>
          Investigate
        </Btn>
      ) : (
        <Link
          to={insight.drilldown.destination}
          className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-xs font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
        >
          {insight.drilldown.label}
        </Link>
      )}
      {primary ? (
        <Link
          to={insight.drilldown.destination}
          className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-xs font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
        >
          {insight.drilldown.label}
        </Link>
      ) : null}
      <span className="flex-1" />
      <OverflowButton label="Insight actions" />
    </div>
  );
}

export function FeaturedInsight({
  insight,
  onInvestigate,
}: {
  insight: InsightCandidate;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  const tag = severityTag(insight);
  return (
    <article className="relative min-w-0 border-r border-border p-[18px_14px_16px] max-[1100px]:border-b max-[1100px]:border-r-0">
      <Tag tone={tag.tone} className="mb-2.5 h-5 text-[10px] tracking-[0.07em]">
        {tag.text}
      </Tag>
      <h3 className="text-[15px] font-semibold leading-[1.35] tracking-[-0.013em]">
        {insight.title}
      </h3>
      <p className="mt-1.5 max-w-[46ch] text-[13px] leading-[1.5] text-text-muted">
        {insight.summary}
      </p>
      <MiniChart
        artifact={insight.artifact}
        tone={tag.tone === "err" ? "err" : "ok"}
      />
      <InsightActions insight={insight} primary onInvestigate={onInvestigate} />
    </article>
  );
}

export function SideInsight({
  insight,
  onInvestigate,
}: {
  insight: InsightCandidate;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  const tag = severityTag(insight);
  return (
    <article className="relative flex min-w-0 flex-1 flex-col justify-center p-[18px_14px_16px]">
      <Tag tone={tag.tone} className="mb-2.5 h-5 text-[10px] tracking-[0.07em]">
        {tag.text}
      </Tag>
      <SideSpark artifact={insight.artifact} />
      <h3 className="text-[15px] font-semibold leading-[1.35] tracking-[-0.013em]">
        {insight.title}
      </h3>
      <p className="mt-1.5 max-w-[46ch] text-[13px] leading-[1.5] text-text-muted">
        {insight.summary}
      </p>
      <InsightActions insight={insight} primary={false} onInvestigate={onInvestigate} />
    </article>
  );
}

export function DataQualityStrip({
  warnings,
  definitionMissing,
  definitionLabel,
}: {
  warnings: readonly string[];
  definitionMissing: boolean;
  definitionLabel: string | null;
}) {
  const title = warnings[0] ?? "Check data coverage.";
  const detail = definitionMissing
    ? `No key outcome is defined yet${definitionLabel ? ` (${definitionLabel})` : ""}. Define one so Prism can answer outcome questions precisely.`
    : (warnings[1] ?? "Coverage below covers the current snapshot.");
  return (
    <div className="grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-[18px] gap-y-2 border-t border-border bg-canvas-subtle p-[13px_14px] max-[520px]:grid-cols-1">
      <div className="flex min-w-0 items-start gap-2.5">
        <span
          aria-hidden="true"
          className="mt-1.5 h-2 w-2 flex-none rounded-full bg-warning shadow-[0_0_0_4px_color-mix(in_oklab,var(--warning)_18%,transparent)]"
        />
        <div className="min-w-0">
          <h3 className="text-[12.5px] font-semibold">{title}</h3>
          <p className="mt-0.5 text-xs text-text-muted">{detail}</p>
        </div>
      </div>
      <Link
        to="sources"
        className="inline-flex h-[30px] items-center justify-center gap-2 whitespace-nowrap rounded-full border border-border-strong px-3 text-xs font-medium text-text transition-colors duration-100 hover:border-text-subtle hover:bg-surface-hover"
      >
        Check source
      </Link>
    </div>
  );
}

export function InsightsGrid({
  insights,
  warnings,
  definitionMissing,
  definitionLabel,
  rangeLabel,
  onInvestigate,
}: {
  insights: readonly InsightCandidate[];
  warnings: readonly string[];
  definitionMissing: boolean;
  definitionLabel: string | null;
  rangeLabel: string;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  const [featured, ...rest] = insights;
  return (
    <>
      <SectionLabel right={rangeLabel}>Insights</SectionLabel>
      {insights.length === 0 && warnings.length === 0 && !definitionMissing ? (
        <p className="rounded-[12px] border border-border p-4 text-sm text-text-muted">
          No significant changes detected in this range. Coverage and pulse
          below reflect the current snapshot.
        </p>
      ) : (
        <Frame className="grid grid-cols-[1.25fr_1fr] overflow-visible bg-surface max-[1100px]:grid-cols-1">
          {featured ? (
            <FeaturedInsight insight={featured} onInvestigate={onInvestigate} />
          ) : null}
          <div className="grid min-w-0 grid-rows-[1fr] max-[1100px]:grid-rows-none">
            {rest.map((insight) => (
              <div
                key={insight.id}
                className="grid [&_+&]:border-t [&_+&]:border-border"
              >
                <SideInsight insight={insight} onInvestigate={onInvestigate} />
              </div>
            ))}
            {rest.length === 0 && !featured ? (
              <p className="p-[18px_14px_16px] text-sm text-text-muted">
                No significant changes detected in this range.
              </p>
            ) : null}
          </div>
          {warnings.length > 0 || definitionMissing ? (
            <div className="col-span-full">
              <DataQualityStrip
                warnings={warnings}
                definitionMissing={definitionMissing}
                definitionLabel={definitionLabel}
              />
            </div>
          ) : null}
        </Frame>
      )}
    </>
  );
}
