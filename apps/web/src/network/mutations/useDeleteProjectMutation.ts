import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  DeleteProjectRequest,
  OkResource,
  ProjectResource,
} from "@prism/types";
import type { AxiosResponse } from "axios";

async function deleteProject(payload: DeleteProjectRequest) {
  const url = `/projects/${payload.projectId}`;

  const response = await axiosInstance.delete<OkResource>(
    url,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useDeleteProjectMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_, { teamId, projectId, slug }) => {
      toast("Project deleted successfully");
      queryClient.setQueryData(["project", slug], () => null);
      const queryData: Array<ProjectResource> | undefined =
        queryClient.getQueryData(["teams", teamId]);
      if (queryData) {
        queryClient.setQueryData(["teams", teamId], () =>
          queryData.filter(({ id }) => id !== projectId),
        );
      }
    },
    onError: (error) => {
      toast("Something went wrong");
    },
  });
}
