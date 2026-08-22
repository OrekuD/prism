import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import { projectsQueryKey } from "@/network/queries/useProjectsQuery";
import type {
  CreateProjectRequest,
  ErrorResource,
  ProjectResource,
} from "@prism-analytics/types";
import type { AxiosError } from "axios";

async function createProject(
  payload: CreateProjectRequest,
): Promise<ProjectResource> {
  const response = await axiosInstance.post<ProjectResource>(
    "/projects",
    payload,
  );
  if (response.status === 200) return response.data;
  throw new Error("create_project_failed");
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    onSuccess: (created: ProjectResource, variables) => {
      toast("Project created successfully");
      // The response IS the created project — append it to its workspace's
      // list cache immediately; the background invalidation keeps truth.
      // F8: update only owning workspace's directory; also invalidate the summary variant
      queryClient.setQueryData<ProjectResource[]>(
        projectsQueryKey(variables.organizationId),
        (list) => (list ? [...list, created] : list),
      );
      queryClient.setQueryData<ProjectResource[]>(
        projectsQueryKey(variables.organizationId, true),
        (list) => (list ? [...list, created] : list),
      );
      void queryClient.invalidateQueries({
        queryKey: projectsQueryKey(variables.organizationId),
      });
      void queryClient.invalidateQueries({
        queryKey: projectsQueryKey(variables.organizationId, true),
      });
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "cannot_create_project":
            toast(
              "You do not have permission to create a project in this workspace.",
            );
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}
