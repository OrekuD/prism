import { axiosInstance } from "@/utils/axiosInstance";
import type { ProjectResource } from "@prism-analytics/types";
import { useQuery } from "@tanstack/react-query";
import { useActiveWorkspace } from "@/lib/workspace";

async function projects(organizationId: string) {
  const response = await axiosInstance.get(`/projects?organizationId=${encodeURIComponent(organizationId)}`);

  if (response.status === 200) {
    return response.data;
  }
}
export function useProjectsQuery() {
  const { data: activeWorkspace } = useActiveWorkspace();
  const organizationId = (activeWorkspace as { id?: string } | null)?.id;
  return useQuery<Array<ProjectResource>>({
    queryKey: ["projects", organizationId],
    queryFn: () => {
      if (!organizationId) {
        return Promise.reject(new Error("No active workspace selected"));
      }
      return projects(organizationId);
    },
    enabled: Boolean(organizationId),
    refetchOnWindowFocus: false,
  });
}
