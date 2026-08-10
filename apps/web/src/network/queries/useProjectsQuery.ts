import { useActiveTeamStore } from "@/store/activeTeamStore";
import { axiosInstance } from "@/utils/axiosInstance";
import type { ProjectResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function projects(teamId: string) {
  const response = await axiosInstance.get(`/teams/${teamId}/projects`);

  if (response.status === 200) {
    return response.data;
  }
}
export function useProjectsQuery() {
  const { teamId } = useActiveTeamStore();
  return useQuery<Array<ProjectResource>>({
    queryKey: ["projects", teamId],
    queryFn: () => {
      if (!teamId) {
        return Promise.reject(new Error("No active team selected"));
      }
      return projects(teamId);
    },
    enabled: Boolean(teamId),
    refetchOnWindowFocus: false,
  });
}
