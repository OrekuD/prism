import * as React from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { areaY, defineChart, stack } from "@tanstack/charts";
import { scaleLinear } from "@tanstack/charts/scales/linear";
import { scalePoint } from "@tanstack/charts/scales/point";
import { tooltip } from "@tanstack/charts/tooltip";
import { Chart } from "@tanstack/charts/react";
import { useParams, useSearchParams } from "react-router-dom";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism/types";
import { Skeleton } from "@/components/ui/skeleton";

const chartConfig = {
  views: {
    label: "Page Views",
  },
  desktop: {
    label: "Desktop",
    color: "var(--chart-1)",
  },
  mobile: {
    label: "Mobile",
    color: "var(--chart-2)",
  },
} as const;

const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });

export function ActivitySummary() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams] = useSearchParams();

  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const { data, isLoading } = useProjectQuery({ slug, duration });
  const [activeChart, setActiveChart] =
    React.useState<keyof typeof chartConfig>("desktop");

  const total = {
    mobile: data?.analytics.device.mobile || 0,
    desktop: data?.analytics.device.desktop || 0,
  };

  // Reshape the summary rows into one long-form series so TanStack Charts
  // can stack them by device on a shared date domain.
  const definition = React.useMemo(() => {
    const rows = (data?.analytics.summary ?? []).flatMap(({ date, desktop, mobile }) => [
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
          fillOpacity: 0.8,
        }),
      ],
      x: {
        scale: () => scalePoint<string>().padding(0.15),
        axis: { ticks: { format: dateLabel } },
      },
      y: {
        scale: scaleLinear,
        nice: true,
        grid: true,
      },
      color: {
        domain: ["desktop", "mobile"],
        range: [chartConfig.desktop.color, chartConfig.mobile.color],
      },
      tooltip,
    });
  }, [data]);

  return (
    <Card>
      <CardHeader className="flex flex-col items-stretch space-y-0 border-b p-0 sm:flex-row">
        <div className="flex flex-1 flex-col justify-center gap-1 px-6 py-5 sm:py-6">
          <CardTitle>User Activity</CardTitle>
          <CardDescription>
            {/* Showing total visitors for the last 3 months */}
          </CardDescription>
        </div>
        <div className="flex">
          {["desktop", "mobile"].map((key) => {
            const chart = key as keyof typeof chartConfig;
            return (
              <button
                key={chart}
                type="button"
                data-active={activeChart === chart}
                className="w-36 relative z-30 flex flex-1 flex-col justify-center px-6 gap-1 border-t py-4 text-left even:border-l data-[active=true]:bg-muted/50 sm:border-l sm:border-t-0 sm:py-6"
                onClick={() => setActiveChart(chart)}
              >
                <span className="text-xs text-muted-foreground">
                  {chartConfig[chart].label}
                </span>
                {isLoading ? (
                  <Skeleton className="mt-1 w-16 h-6 sm:h-8" />
                ) : (
                  <span className="text-lg font-bold leading-none sm:text-3xl">
                    {total[key as keyof typeof total].toLocaleString()}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </CardHeader>

      <CardContent className="px-2 sm:p-6">
        {isLoading ? (
          <Skeleton className="aspect-auto h-[250px] w-full" />
        ) : (
          <Chart
            definition={definition}
            height={250}
            ariaLabel="User activity by device over time"
            className="w-full"
          />
        )}
      </CardContent>
    </Card>
  );
}
