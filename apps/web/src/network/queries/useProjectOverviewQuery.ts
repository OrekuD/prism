import { axiosInstance } from "@/utils/axiosInstance";
import type { ProjectOverviewResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";

/**
 * Canonical adaptive overview (Task 21 slice 3): deterministic insights,
 * stable pulse, activity, and secondary panel over one server snapshot.
 * The range key is the entire query identity (no moving timestamps in
 * keys); the server resolves `asOf` and returns the snapshot token that
 * drill-downs reuse verbatim.
 */
export function overviewQueryKey(params: {
  slug: string;
  range: string;
  ctx?: string | null;
}) {
  return [
    "workspace-project-overview",
    params.slug,
    params.range,
    params.ctx ?? null,
  ] as const;
}

async function fetchOverview(
  slug: string,
  range: string,
): Promise<ProjectOverviewResource> {
  const response = await axiosInstance.get<ProjectOverviewResource>(
    `/projects/${slug}/overview`,
    { params: { range } },
  );
  if (response.status === 200) return response.data;
  throw new Error("project_overview_failed");
}

export function useProjectOverviewQuery(
  slug: string | undefined,
  args: { range: string; enabled?: boolean },
) {
  return useQuery({
    queryKey: overviewQueryKey({ slug: slug ?? "", range: args.range }),
    queryFn: () => fetchOverview(slug ?? "", args.range),
    enabled: Boolean(slug) && Boolean(args.range) && (args.enabled ?? true),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
}
