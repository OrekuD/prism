import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { barY, defineChart } from "@tanstack/charts";
import { scaleBand } from "@tanstack/charts/scales/band";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { useMemo } from "react";
import type { ProjectDetailedResource } from "@prism/types";

type Props = {
  isLoading: boolean;
  label: string;
  data?: ProjectDetailedResource["analytics"]["browserStats"];
};

export function RankingsChart(props: Props) {
  const ranked = Object.entries(props.data || {})
    .map(([label, value]) => ({ label, value }))
    .sort((a, b) => b.value - a.value);

  // Module-level formatting must not be recreated per render; the definition
  // is memoized on the ranked rows so the chart only rebuilds when data moves.
  const definition = useMemo(() => {
    return defineChart({
      marks: [
        barY(ranked, {
          x: "label",
          y: "value",
          inset: 2,
        }),
      ],
      x: {
        scale: () =>
          scaleBand<string>()
            .domain(ranked.map((row) => row.label))
            .padding(0.16),
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
      },
      tooltip,
    });
  }, [ranked]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-xl">{props.label}</CardTitle>
        <CardDescription>
          January - June {new Date().getFullYear()}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {props.isLoading ? (
          <div className="h-[250px] w-full animate-pulse rounded-md bg-muted" />
        ) : (
          <Chart
            definition={definition}
            height={250}
            ariaLabel={`${props.label} by browser`}
          />
        )}
      </CardContent>
    </Card>
  );
}
