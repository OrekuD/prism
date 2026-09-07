import { axiosInstance } from "@/utils/axiosInstance";
import type { MetricFact, PublicQueryContext } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Canonical project metrics (Task 21 slice 2): server-computed aggregates
 * over one resolved snapshot — never paginated page lengths summed in
 * React. The range key and metric IDs are the entire query identity (no
 * moving timestamps in keys); the server resolves `asOf` and returns the
 * snapshot token with the facts.
 */
export interface ProjectMetricsResult {
  queryContext: PublicQueryContext;
  queryContextToken: string;
  facts: MetricFact[];
}

async function projectMetrics(
  slug: string | undefined,
  ids: string[],
  range: string,
): Promise<ProjectMetricsResult | null> {
  if (!slug) return null;
  const response = await axiosInstance.get(`/projects/${slug}/metrics`, {
    params: { ids: ids.join(","), range },
  });
  return response.data as ProjectMetricsResult;
}

export function useProjectMetricsQuery(
  slug: string | undefined,
  args: { ids: string[]; range: string },
) {
  const key = args.ids.join(",");
  return useQuery<ProjectMetricsResult | null>({
    queryKey: ["project-metrics", slug, key, args.range],
    queryFn: () => projectMetrics(slug, args.ids, args.range),
    enabled: Boolean(slug) && args.ids.length > 0,
    staleTime: 30_000,
  });
}

/** One fact by metric ID from a metrics result (null when not measured). */
export function metricFactFor(
  result: ProjectMetricsResult | null | undefined,
  metricId: string,
): MetricFact | null {
  return result?.facts.find((fact) => fact.metricId === metricId) ?? null;
}
