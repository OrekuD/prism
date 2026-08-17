import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  CreateProjectRequest,
  ErrorResource,
  OkResource,
} from "@prism-analytics/types";
import type { AxiosError } from "axios";

async function createProject(payload: CreateProjectRequest) {
  const response = await axiosInstance.post("/projects", payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    onSuccess: (data: OkResource, variables) => {
      toast("Project created successfully");
      queryClient.invalidateQueries({
        queryKey: ["projects", variables.organizationId],
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
