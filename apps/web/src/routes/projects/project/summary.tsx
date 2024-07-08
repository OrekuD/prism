import { ActivitySummary } from "@/components/ui/activity-summary";
import {
  Card,
  CardTitle,
  CardHeader,
  CardContent,
  CardDescription,
} from "@/components/ui/card";
import { RankingsChart } from "@/components/ui/rankings-chart";
import { RankingsSummary } from "@/components/ui/rankings-summary";
import React from "react";
import { Line, LineChart, ResponsiveContainer, Tooltip } from "recharts";

const chartData = [
  { label: "January", value: 186 },
  { label: "February", value: 305 },
  { label: "March", value: 237 },
  { label: "April", value: 73 },
  { label: "May", value: 209 },
  { label: "June", value: 214 },
];

export function ProjectSummary() {
  return (
    <div className="space-y-4">
      <ActivitySummary />
      <RankingsSummary />
    </div>
  );
}
