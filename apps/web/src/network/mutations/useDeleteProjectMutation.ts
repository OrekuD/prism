import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type { OkResource } from "@prism-analytics/types";
import type { ProjectResource } from "@prism-analytics/types";
import { useSelectedWorkspace } from "@/lib/workspace";
import { projectsQueryKey } from "@/network/queries/useProjectsQuery";

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
  const { workspace: selected } = useSelectedWorkspace();
  return useMutation({
    mutationFn: deleteProject,
    onSuccess: (_data, projectId) => {
      toast("Project deleted successfully");
      queryClient.setQueryData(["project", slug], () => null);
      // F8: only the owning workspace's directory — not every workspace.
      for (const withSummary of [false, true] as const) {
        const key = projectsQueryKey(selected?.id, withSummary || undefined);
        queryClient.setQueriesData<Array<ProjectResource> | undefined>(
          { queryKey: key },
          (current) => current?.filter((project) => project.id !== projectId),
        );
        queryClient.invalidateQueries({ queryKey: key });
      }
    },
    onError: () => {
      toast("Something went wrong");
    },
  });
}
