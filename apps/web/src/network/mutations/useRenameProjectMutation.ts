import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  ErrorResource,
  OkResource,
  ProjectResource,
  RenameProjectRequest,
} from "@prism-analytics/types";
import type { AxiosError } from "axios";

async function renameProject(payload: RenameProjectRequest & { projectId: string }) {
  const { projectId, ...body } = payload;
  const response = await axiosInstance.patch<OkResource>(
    `/projects/${projectId}`,
    body,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useRenameProjectMutation(slug: string | undefined) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: renameProject,
    onSuccess: (_data, payload) => {
      toast("Project renamed");
      // Patch the new name into the caches right away (we know the value we
      // just sent); invalidate keeps server truth in the background.
      const renamed = (project: ProjectResource): ProjectResource =>
        project.id === payload.projectId
          ? { ...project, name: payload.name }
          : project;
      queryClient.setQueryData<ProjectResource>(["project", slug], (project) =>
        project ? renamed(project) : project,
      );
      queryClient.setQueriesData<Array<ProjectResource> | undefined>(
        { queryKey: ["projects"] },
        (current) => current?.map(renamed),
      );
      queryClient.invalidateQueries({ queryKey: ["project", slug] });
      queryClient.invalidateQueries({ queryKey: ["projects"] });
    },
    onError: (error: AxiosError<ErrorResource>) => {
      toast(
        error.response?.data.errors?.[0] === "cannot_rename_project"
          ? "You don't have permission to rename this project"
          : "Something went wrong",
      );
    },
  });
}
