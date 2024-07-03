import { useMutation, useQueryClient } from "@tanstack/react-query";
import { axiosInstance } from "@/utils/axiosInstance";
import { toast } from "sonner";
import {
  DeleteTeamRequest,
  ErrorResource,
  JoinTeamRequest,
  LeaveTeamRequest,
  OkResource,
  TeamResource,
} from "@prism/types";
import { AxiosError, AxiosResponse } from "axios";

async function leaveTeam(payload: LeaveTeamRequest) {
  const url = `/teams/${payload.teamId}/leave`;

  const response = await axiosInstance.post<any, AxiosResponse<OkResource>>(
    url,
    payload,
  );

  if (response.status === 200) {
    return response.data;
  }
}

export function useLeaveTeamMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: leaveTeam,
    onSuccess: (_, { teamId }) => {
      toast("You've left");
      const teams: Array<TeamResource> | undefined = queryClient.getQueryData([
        "teams",
      ]);

      if (teams) {
        queryClient.setQueryData(["teams"], () =>
          teams.filter(({ id }) => id !== teamId),
        );
      }

      // queryClient.invalidateQueries({queryKey: ['']})
    },
    onError: (error: AxiosError<ErrorResource>) => {
      // console.log({ error });
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
