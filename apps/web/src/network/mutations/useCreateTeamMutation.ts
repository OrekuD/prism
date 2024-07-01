import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import type {
  CreateTeamRequest,
  ErrorResource,
  TeamResource,
} from "@prism/types";
import { AxiosError } from "axios";

async function createTeams(payload: CreateTeamRequest) {
  const url = "/teams";

  const response = await axiosInstance.post(url, payload);

  if (response.status === 200) {
    return response.data;
  }
}

export function useCreateTeamMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: createTeams,
    onSuccess: (data: TeamResource) => {
      console.log({ data });
      queryClient.invalidateQueries({ queryKey: ["teams"] });
      // queryClient.setQueryData(["teams", ], data);
      toast("Team created succesfully");
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "max_number_teams_exceeded":
            toast("You need to upgrade to the Pro plan");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}
