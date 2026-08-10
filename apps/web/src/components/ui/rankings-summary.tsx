import React from "react";
import { RankingsChart } from "./rankings-chart";
import { useProjectQuery } from "@/network/queries/useProjectQuery";
import type { ProjectDetailedRequest } from "@prism/types";
import { useParams, useSearchParams } from "react-router-dom";

export function RankingsSummary() {
  const { slug } = useParams<{ slug: string }>();
  const [searchParams, setSearchParams] = useSearchParams();

  const duration = searchParams.get(
    "duration",
  ) as ProjectDetailedRequest["duration"];
  const { data, isLoading } = useProjectQuery({ slug, duration });

  return (
    <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
      <RankingsChart
        data={data?.analytics.browserStats}
        isLoading={isLoading}
        label="Top Browser"
      />
      <RankingsChart
        data={data?.analytics.osStats}
        isLoading={isLoading}
        label="Top OS"
      />
      <RankingsChart
        data={data?.analytics.countryStats}
        isLoading={isLoading}
        label="Top Country"
      />
    </div>
  );
}
