import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  CreateProjectRequest,
  CreateTeamRequest,
  ErrorResource,
  OkResource,
  TeamResource,
} from "@prism/types";
import { AxiosError } from "axios";

async function createProject(payload: CreateProjectRequest) {
  const url = `/projects/${payload.teamId}`;

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useCreateProjectMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createProject,
    onSuccess: (data: OkResource) => {
      toast("Project created succesfully");
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "":
            toast("You need to upgrade to the Pro plan");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}
