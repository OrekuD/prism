import { areaY, defineChart, stack } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { useMemo } from "react";

export type ProjectSummaryRow = {
  date: string;
  desktop: number;
  mobile: number;
};

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

/** Compact stacked-area sparkline for project cards. */
export function ProjectSparkline({ summary }: { summary?: ProjectSummaryRow[] }) {
  const definition = useMemo(() => {
    const rows = (summary ?? []).flatMap(({ date, desktop, mobile }) => [
      { date, device: "desktop", count: desktop },
      { date, device: "mobile", count: mobile },
    ]);

    return defineChart({
      marks: [
        areaY(rows, {
          x: "date",
          y: "count",
          color: "device",
          layout: stack({ order: ["mobile", "desktop"] }),
          fillOpacity: 0.7,
        }),
      ],
      x: {
        scale: () => scalePoint<string>().padding(0.15),
        axis: { ticks: { format: dateLabel } },
      },
      y: {
        scale: scaleLinear,
        nice: true,
      },
      color: {
        domain: ["desktop", "mobile"],
        range: ["hsl(var(--chart-1))", "hsl(var(--chart-2))"],
      },
      tooltip,
    });
  }, [summary]);

  return (
    <Chart
      definition={definition}
      height={150}
      ariaLabel="Project activity over time"
      className="pb-2"
    />
  );
}
