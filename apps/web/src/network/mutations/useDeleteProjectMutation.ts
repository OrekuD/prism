import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { OkResource } from "@prism-analytics/types";
import type { ProjectResource } from "@prism-analytics/types";

async function deleteProject(projectId: string) {
  const response = await axiosInstance.delete<OkResource>(
    `/projects/${projectId}`,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useDeleteProjectMutation(slug?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_data, projectId) => {
      toast("Project deleted successfully");
      queryClient.setQueryData(["project", slug], () => null);
      // Drop the project from every projects list cache immediately.
      queryClient.setQueriesData<Array<ProjectResource> | undefined>(
        { queryKey: ["projects"] },
        (current) => current?.filter((project) => project.id !== projectId),
      );
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: () => {
      toast("Something went wrong");
    },
  });
}
