import { ActivitySummary } from "@/components/charts/activity-summary";
import { MetricsFrame } from "@/components/charts/metrics-frame";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useIssuesQuery } from "@/network/queries/useIssuesQuery";
import { Link, useParams } from "react-router-dom";

export function ProjectSummary() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectQuery({ slug, duration: "three-months" });
  const eventsQuery = useProjectEventsQuery(slug, { limit: 50 });
  // Error health (task-15 item 437): unresolved issues + error events in a
  // fixed window, computed from the same server-filtered source the Errors
  // page uses. Only real grouped issues contribute — never a fabricated graph.
  const issuesQuery = useIssuesQuery(slug, { range: "seven-days" });
  const issues = issuesQuery.data?.items ?? [];
  const errorEvents = issues.reduce((sum, issue) => sum + issue.count, 0);
  const unresolved = issues.filter((issue) => issue.status === "unresolved").length;

  // "Sessions", never "Visitors": the v2 model counts client-owned
  // session_started events — cross-session visitor uniqueness does not
  // exist yet (task-9 §10).
  const sessions =
    (data?.analytics.device.desktop ?? 0) + (data?.analytics.device.mobile ?? 0);

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
            value: eventsQuery.data?.events.length ?? 0,
            unit: "logged",
          },
          {
            id: "unresolved-errors",
            label: "Unresolved",
            icon: "error",
            value: unresolved,
            unit: "issues · 7d",
          },
          {
            id: "error-events",
            label: "Error events",
            icon: "error",
            value: errorEvents,
            unit: "captured · 7d",
          },
        ]}
        isLoading={isLoading || eventsQuery.isLoading || issuesQuery.isLoading}
      />
      {issuesQuery.isError ? (
        <p className="px-1 font-mono text-[11px] text-danger">
          Error health unavailable — could not load issue data.
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
