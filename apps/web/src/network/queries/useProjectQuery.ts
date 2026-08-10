import { useActiveTeamStore } from "@/store/activeTeamStore";
import { axiosInstance } from "@/utils/axiosInstance";
import {
  type ProjectDetailedRequest,
  type ProjectDetailedResource,
  ProjectResource,
} from "@prism/types";
import { useQuery } from "@tanstack/react-query";

async function project(payload: ProjectDetailedRequest) {
  const params = payload.duration ? `?duration=${payload.duration}` : "";
  const response = await axiosInstance.get(
    `/projects/${payload.slug}${params}`,
  );

  if (response.status === 200) {
    return response.data;
  }
}
export function useProjectQuery(payload: ProjectDetailedRequest) {
  return useQuery<ProjectDetailedResource>({
    queryKey: ["project", payload.slug, payload.duration],
    queryFn: () => project(payload),
    enabled: Boolean(payload.slug),
    refetchOnWindowFocus: false,
  });
}
