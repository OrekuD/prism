/**
 * Overview view: title block + widget column bound to the canonical
 * `ProjectOverviewResource`. Geometry-preserving skeletons while
 * loading; a compact retry state on error; never a model call.
 */
import type {
  InsightCandidate,
  ProjectOverviewResource,
} from "@prism-analytics/types";
import { ActivitySection } from "@/components/project-overview/activity";
import { InsightsGrid } from "@/components/project-overview/insights";
import { MetricGrid } from "@/components/project-overview/metrics";
import type { MetricFact } from "@prism-analytics/types";
import { Btn } from "@/components/project-overview/primitives";
import { AlertCircle, RefreshCw } from "@/components/ui/hugeicons";

export function OverviewView({
  resource,
  isLoading,
  isError,
  isRetrying,
  onRetry,
  onInvestigate,
}: {
  resource: ProjectOverviewResource | undefined;
  isLoading: boolean;
  isError: boolean;
  isRetrying: boolean;
  onRetry: () => void;
  onInvestigate: (insight: InsightCandidate) => void;
}) {
  if (isLoading) {
    return (
      <div className="flex flex-1 flex-col pb-2" aria-label="Loading project overview">
        <div className="mb-1.5 mt-10">
          <div className="h-7 w-56 animate-pulse rounded-md bg-border-subtle/40" />
          <div className="mt-2 h-4 w-96 animate-pulse rounded-md bg-border-subtle/40" />
        </div>
        <div className="mb-3 mt-9 h-4 w-40 animate-pulse rounded-md bg-border-subtle/40" />
        <div className="h-48 animate-pulse rounded-md bg-border-subtle/40" />
        <div className="mb-3 mt-9 h-4 w-40 animate-pulse rounded-md bg-border-subtle/40" />
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-[108px] animate-pulse rounded-md bg-border-subtle/40"
            />
          ))}
        </div>
      </div>
    );
  }
  if (isError || !resource) {
    return (
      <div
        role="alert"
        className="mt-8 flex max-w-xl items-start gap-3 py-4"
      >
        <AlertCircle aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-text-subtle" />
        <div className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div>
            <h2 className="text-sm font-medium text-text">Couldn't load overview</h2>
            <p className="mt-1 text-[13px] leading-5 text-text-muted">Try loading it again.</p>
          </div>
          <Btn
            variant="ghost"
            size="md"
            onClick={onRetry}
            disabled={isRetrying}
            aria-busy={isRetrying}
            className="h-10 rounded-[10px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
          >
            <RefreshCw aria-hidden="true" />
            {isRetrying ? "Retrying…" : "Retry"}
          </Btn>
        </div>
      </div>
    );
  }

  const activitySeries =
    resource.activity.kind === "timeseries"
      ? (resource.activity.series[0]?.points.map((point) => point.value) ?? [])
      : [];
  const sparkFor = (fact: MetricFact) => {
    if (
      fact.metricId !== "project.accepted_events" ||
      activitySeries.length < 2
    ) {
      return undefined;
    }
    return { points: activitySeries, tone: "text" as const };
  };
  const supportingAccepted = [
    ...resource.pulse,
    ...resource.supportingFacts,
  ].find((fact) => fact.metricId === "project.accepted_events");

  return (
    <div className="flex flex-1 flex-col pb-2">
      <InsightsGrid
        insights={resource.insights}
        warnings={resource.dataQuality.warnings}
        hasAcceptedData={resource.dataQuality.hasAcceptedData}
        definitionMissing={resource.dataQuality.definitionState === "missing"}
        definitionLabel={resource.dataQuality.definitionLabel}
        onInvestigate={onInvestigate}
      />
      <MetricGrid facts={resource.pulse} sparkFor={sparkFor} />
      <ActivitySection
        activity={resource.activity}
        secondary={resource.secondary}
        supportingFact={supportingAccepted}
      />
    </div>
  );
}
