import { ActivitySummary } from "@/components/charts/activity-summary";
import { MetricsFrame } from "@/components/charts/metrics-frame";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import { useProjectEventsQuery } from "@/network/queries/useProjectEventsQuery";
import { useParams } from "react-router-dom";

export function ProjectSummary() {
  const { slug } = useParams<{ slug: string }>();
  const { data, isLoading } = useProjectQuery({ slug, duration: "three-months" });
  const eventsQuery = useProjectEventsQuery(slug);

  // "Sessions", never "Visitors": the v2 model counts client-owned
  // session_started events — cross-session visitor uniqueness does not
  // exist yet (task-9 §10).
  const sessions =
    (data?.analytics.device.desktop ?? 0) + (data?.analytics.device.mobile ?? 0);

  return (
    <div className="grid gap-4">
      <MetricsFrame
        isLoading={isLoading}
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
            value: eventsQuery.data?.length ?? 0,
            unit: "logged",
          },
        ]}
      />
      <ActivitySummary />
    </div>
  );
}
