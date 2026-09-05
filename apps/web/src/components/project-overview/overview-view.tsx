/**
 * Overview view: title block + widget column bound to the canonical
 * `ProjectOverviewResource`. Geometry-preserving skeletons while
 * loading; a fail-closed alert (which also pauses the assistant) on
 * error; never a model call.
 */
import type {
  InsightCandidate,
  ProjectOverviewResource,
} from "@prism-analytics/types";
import { ActivitySection } from "@/components/project-overview/activity";
import { InsightsGrid } from "@/components/project-overview/insights";
import { MetricGrid } from "@/components/project-overview/metrics";
import type { MetricFact } from "@prism-analytics/types";

function rangeLabel(from: number, to: number): string {
  const start = new Date(from).toISOString().slice(0, 10);
  const end = new Date(to).toISOString().slice(0, 10);
  return `${start} – ${end}`;
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
      <div className="flex flex-1 flex-col pb-2" aria-label="Loading project overview">
        <div className="mb-1.5 mt-10">
          <div className="h-7 w-56 animate-pulse rounded-sm bg-border-subtle/40" />
          <div className="mt-2 h-4 w-96 animate-pulse rounded-sm bg-border-subtle/40" />
        </div>
        <div className="mb-3 mt-9 h-4 w-40 animate-pulse rounded-sm bg-border-subtle/40" />
        <div className="h-48 animate-pulse rounded-sm bg-border-subtle/40" />
        <div className="mb-3 mt-9 h-4 w-40 animate-pulse rounded-sm bg-border-subtle/40" />
        <div className="grid grid-cols-3 gap-2.5">
          {[0, 1, 2].map((index) => (
            <div
              key={index}
              className="h-[108px] animate-pulse rounded-sm bg-border-subtle/40"
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
        className="mt-10 rounded-sm border border-danger/40 bg-danger/5 p-5"
      >
        <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.022em]">
          Project overview unavailable
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          Prism could not load this snapshot. The assistant is also paused
          until the overview loads — try again shortly.
        </p>
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
      <div className="mb-1.5 mt-2">
        <h1 className="text-[26px] font-semibold leading-[1.2] tracking-[-0.022em]">
          Project overview
        </h1>
        <p className="mt-1.5 text-sm text-text-muted">
          Current health, behavior, and changes across this project.
        </p>
      </div>

      <div className="flex flex-1 flex-col pb-2">
        <InsightsGrid
          insights={resource.insights}
          warnings={resource.dataQuality.warnings}
          definitionMissing={resource.dataQuality.definitionState === "missing"}
          definitionLabel={resource.dataQuality.definitionLabel}
          rangeLabel={rangeLabel(
            resource.queryContext.from,
            resource.queryContext.to,
          )}
          onInvestigate={onInvestigate}
        />
        <MetricGrid
          facts={resource.pulse}
          sparkFor={sparkFor}
          rangeLabel={rangeLabel(
            resource.queryContext.from,
            resource.queryContext.to,
          )}
        />
        <ActivitySection
          activity={resource.activity}
          secondary={resource.secondary}
          supportingFact={supportingAccepted}
        />
      </div>
    </div>
  );
}
