import { LocalStorageKeys } from "@/constants/LocalStorageKeys";
import { useActiveTeamStore } from "@/store/activeTeamStore";
import { axiosInstance } from "@/utils/axiosInstance";
import { ProjectDetailedResource, ProjectResource } from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function project(projectSlug: string) {
  const response = await axiosInstance.get(`/projects/${projectSlug}`);

  if (response.status === 200) {
    return response.data;
  }
}
export function useProjectQuery(projectSlug?: string) {
  return useQuery<ProjectDetailedResource>({
    queryKey: ["project", projectSlug],
    queryFn: () => project(projectSlug!),
    enabled:
      Boolean(localStorage.getItem(LocalStorageKeys.TOKEN)) &&
      Boolean(projectSlug),
    refetchOnWindowFocus: false,
  });
}
