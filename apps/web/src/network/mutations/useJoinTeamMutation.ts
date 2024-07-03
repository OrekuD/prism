import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import {
  DeleteTeamRequest,
  ErrorResource,
  JoinTeamRequest,
  OkResource,
  TeamResource,
} from "@prism/types";
import { AxiosError, AxiosResponse } from "axios";

async function joinTeam(payload: JoinTeamRequest) {
  const url = `/teams/${payload.teamId}/join`;

  const response = await axiosInstance.post<any, AxiosResponse<OkResource>>(
    url,
    payload,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useJoinTeamMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: joinTeam,
    onSuccess: (_, { teamId }) => {
      toast("Team joined successfully");
      // queryClient.invalidateQueries({queryKey: ['']})
    },
    onError: (error: AxiosError<ErrorResource>) => {
      if (
        !error.response?.data.errors ||
        error.response.data.errors.length === 0
      ) {
        toast("Something went wrong");
      } else {
        switch (error.response.data.errors[0]) {
          case "team_not_found":
            toast("Team not found");
            break;
          case "team_owner":
            toast("You're already a member of this team.");
            break;
          case "already_a_team_member":
            toast("You're already a member of this team.");
            break;
          default:
            toast("Something went wrong");
        }
      }
    },
  });
}
