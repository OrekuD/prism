import { ActivitySummary } from "@/components/charts/activity-summary";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { RankingsChart } from "@/components/charts/rankings-chart";
import { RankingsSummary } from "@/components/charts/rankings-summary";
export function ProjectSummary() {
  return (
    <div className="space-y-4">
      <ActivitySummary />
      <RankingsSummary />
    </div>
  );
}
