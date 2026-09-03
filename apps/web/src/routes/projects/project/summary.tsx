import { ActivitySummary } from "@/components/charts/activity-summary";
import { MetricsFrame } from "@/components/charts/metrics-frame";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import {
  metricFactFor,
  useProjectMetricsQuery,
} from "@/network/queries/useProjectMetricsQuery";
import { Link, useParams } from "react-router-dom";

const HEALTH_IDS = [
  "project.accepted_events",
  "errors.unresolved_issues",
  "errors.occurrences",
];

export function ProjectSummary() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectQuery({
    slug,
    duration: "three-months",
  });
  // Canonical aggregates (Task 21 slice 2): the event total is a real
  // snapshot aggregate and error health comes from canonical issue
  // aggregates — never a paginated page length or a React-side summation.
  const metricsQuery = useProjectMetricsQuery(slug, {
    ids: HEALTH_IDS,
    range: "7d",
  });
  const eventsFact = metricFactFor(
    metricsQuery.data,
    "project.accepted_events",
  );
  const unresolvedFact = metricFactFor(
    metricsQuery.data,
    "errors.unresolved_issues",
  );
  const occurrencesFact = metricFactFor(
    metricsQuery.data,
    "errors.occurrences",
  );
  const errorHealthConfigured =
    unresolvedFact !== null && unresolvedFact.value !== null;
  // Unconfigured error health renders a setup state, never fabricated
  // zeros (the frame's own contract: real zeros only after success).
  const showErrorCells = metricsQuery.isLoading || errorHealthConfigured;

  // "Sessions", never "Visitors": the v2 model counts client-owned
  // session_started events — cross-session visitor uniqueness does not
  // exist yet (task-9 §10).
  const sessions =
    (data?.analytics.device.desktop ?? 0) +
    (data?.analytics.device.mobile ?? 0);

  return (
    <div className="grid gap-4">
      <MetricsFrame
        cells={[
          {
            id: "sessions",
            label: "Sessions",
            icon: "visitors",
            value: sessions,
            unit: "this period",
          },
          {
            id: "desktop",
            label: "Desktop",
            icon: "sessions",
            value: data?.analytics.device.desktop ?? 0,
            unit: "sessions",
          },
          {
            id: "events",
            label: "Events",
            icon: "events",
            value: eventsFact?.value ?? 0,
            unit: "logged · 7d",
          },
          ...(showErrorCells
            ? [
                {
                  id: "unresolved-errors",
                  label: "Unresolved",
                  icon: "error" as const,
                  value: unresolvedFact?.value ?? 0,
                  unit: "issues · 7d",
                },
                {
                  id: "error-events",
                  label: "Error events",
                  icon: "error" as const,
                  value: occurrencesFact?.value ?? 0,
                  unit: "captured · 7d",
                },
              ]
            : []),
        ]}
        isLoading={isLoading || metricsQuery.isLoading}
      />
      {metricsQuery.isError ? (
        <p className="px-1 font-mono text-[11px] text-danger">
          Error health unavailable — could not load canonical metrics.
        </p>
      ) : !errorHealthConfigured && !metricsQuery.isLoading ? (
        <p className="px-1 font-mono text-[11px] text-text-subtle">
          Error collection is not configured for this project — connect error
          capture from{" "}
          <Link to="sources" className="font-medium text-link hover:underline">
            Sources
          </Link>{" "}
          to see error health here.
        </p>
      ) : (
        <Link
          to="errors"
          className="px-1 font-mono text-[11px] text-text-subtle transition-colors hover:text-link"
        >
          Open the Errors page to resolve, ignore, or reopen these issues.
        </Link>
      )}
      <ActivitySummary />
    </div>
  );
}
