import { ActivitySummary } from "@/components/charts/activity-summary";
import { MetricsFrame } from "@/components/charts/metrics-frame";
import { RankingsSummary } from "@/components/charts/rankings-summary";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useParams } from "react-router-dom";

export function ProjectSummary() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectQuery({ slug, duration: "three-months" });
  const eventsQuery = useProjectEventsQuery(slug);

  const visitors =
    (data?.analytics.device.desktop ?? 0) + (data?.analytics.device.mobile ?? 0);

  return (
    <div className="grid gap-4">
      <MetricsFrame
        isLoading={isLoading}
        cells={[
          {
            id: "visitors",
            label: "Visitors",
            icon: "visitors",
            value: visitors,
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
            value: eventsQuery.data?.length ?? 0,
            unit: "logged",
          },
        ]}
      />
      <ActivitySummary />
      <RankingsSummary />
    </div>
  );
}
