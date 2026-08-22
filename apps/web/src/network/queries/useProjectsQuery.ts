import { axiosInstance } from "@/utils/axiosInstance";
import type { ProjectResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";
import { useSelectedWorkspace } from "@/lib/workspace";

export const projectsQueryKey = (
  organizationId: string | undefined,
  includeSummary?: boolean,
) => ["workspace", organizationId, "projects", includeSummary ? "summary" : "directory"] as const;

async function projects(organizationId: string, includeSummary?: boolean) {
  const qs = includeSummary ? "&includeSummary=true" : "";
  const response = await axiosInstance.get(
    `/projects?organizationId=${encodeURIComponent(organizationId)}${qs}`,
  );

  if (response.status === 200) {
    return response.data;
  }
}
export function useProjectsQuery(opts: { includeSummary?: boolean } = {}) {
  const { workspace: selectedWorkspace } = useSelectedWorkspace();
  const organizationId = selectedWorkspace?.id;
  return useQuery<Array<ProjectResource>>({
    queryKey: projectsQueryKey(organizationId, opts.includeSummary),
    queryFn: () => {
      if (!organizationId) {
        return Promise.reject(new Error("No active workspace selected"));
      }
      return projects(organizationId, opts.includeSummary);
    },
    enabled: Boolean(organizationId),
    // F5: kept fresh for 2 min (main.tsx default) — revisits hit cache immediately.
  });
}
